import type { ConfidenceMask } from "./armBoundary";

export type SegmenterMode = "IMAGE" | "VIDEO";

type WorkerReadyMessage = { type: "ready" };
type WorkerResultMessage = {
  type: "result";
  timestamp: number;
  width: number;
  height: number;
  data: Float32Array | null;
};
type WorkerErrorMessage = { type: "error"; message: string };
type WorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

type PendingRequest = {
  resolve: (mask: ConfidenceMask | null) => void;
  reject: (error: Error) => void;
};

export class BodySkinSegmenter {
  private readonly pending = new Map<number, PendingRequest>();
  private busy = false;
  private closed = false;

  private constructor(private readonly worker: Worker) {
    worker.addEventListener("message", this.handleMessage);
  }

  static create(mode: SegmenterMode = "VIDEO") {
    return new Promise<BodySkinSegmenter>((resolve, reject) => {
      const worker = new Worker(new URL("./skinSegmenter.worker.ts", import.meta.url), {
        type: "module",
      });
      const segmenter = new BodySkinSegmenter(worker);
      const handleStartup = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "ready") {
          worker.removeEventListener("message", handleStartup);
          worker.removeEventListener("error", handleWorkerError);
          resolve(segmenter);
        } else if (event.data.type === "error") {
          worker.removeEventListener("message", handleStartup);
          worker.removeEventListener("error", handleWorkerError);
          segmenter.close();
          reject(new Error(event.data.message));
        }
      };
      const handleWorkerError = (event: ErrorEvent) => {
        worker.removeEventListener("message", handleStartup);
        worker.removeEventListener("error", handleWorkerError);
        segmenter.close();
        reject(new Error(event.message || "皮肤分割 Worker 初始化失败"));
      };
      worker.addEventListener("message", handleStartup);
      worker.addEventListener("error", handleWorkerError);
      worker.postMessage({ type: "init", mode });
    });
  }

  get isProcessing() {
    return this.busy;
  }

  segment(source: CanvasImageSource, timestamp: number) {
    if (this.closed || this.busy) return null;
    this.busy = true;
    return this.runSegment(source, timestamp).finally(() => {
      this.busy = false;
    });
  }

  private async runSegment(source: CanvasImageSource, timestamp: number) {
    try {
      const bitmap = await createImageBitmap(source);
      if (this.closed) {
        bitmap.close();
        return null;
      }
      return await new Promise<ConfidenceMask | null>((resolve, reject) => {
        this.pending.set(timestamp, { resolve, reject });
        this.worker.postMessage({ type: "segment", bitmap, timestamp }, [bitmap]);
      });
    } catch (error) {
      if (this.closed) return null;
      throw error;
    }
  }

  private readonly handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type !== "result") return;
    const request = this.pending.get(message.timestamp);
    if (!request) return;
    this.pending.delete(message.timestamp);
    if (!message.data) {
      request.resolve(null);
      return;
    }
    request.resolve({
      data: message.data,
      width: message.width,
      height: message.height,
    });
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.terminate();
    const error = new Error("皮肤分割器已关闭");
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}
