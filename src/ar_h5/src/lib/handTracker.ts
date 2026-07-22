import type { HandFrame } from "../types/ar";

export type TrackerMode = "IMAGE" | "VIDEO";

type WorkerReadyMessage = { type: "ready" };
type WorkerResultMessage = { type: "result"; frame: HandFrame | null; timestamp: number };
type WorkerErrorMessage = { type: "error"; message: string };
type WorkerMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

type TrackerCallbacks = {
  onResult: (frame: HandFrame | null, timestamp: number) => void;
  onError: (error: Error) => void;
};

export class BrowserHandTracker {
  private processing = false;
  private closed = false;

  private constructor(
    private readonly worker: Worker,
    private callbacks: TrackerCallbacks,
  ) {
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerError);
  }

  static create(mode: TrackerMode, callbacks: TrackerCallbacks, signal?: AbortSignal) {
    if (signal?.aborted) {
      return Promise.reject<BrowserHandTracker>(new DOMException("手部追踪初始化已取消", "AbortError"));
    }
    return new Promise<BrowserHandTracker>((resolve, reject) => {
      const worker = new Worker(new URL("./handTracker.worker.ts", import.meta.url), {
        type: "module",
      });
      const tracker = new BrowserHandTracker(worker, callbacks);
      const cleanupStartup = () => {
        worker.removeEventListener("message", handleStartup);
        worker.removeEventListener("error", handleStartupError);
        signal?.removeEventListener("abort", handleAbort);
      };
      const handleStartup = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "ready") {
          cleanupStartup();
          resolve(tracker);
        } else if (event.data.type === "error") {
          cleanupStartup();
          tracker.close();
          reject(new Error(event.data.message));
        }
      };
      const handleStartupError = (event: ErrorEvent) => {
        cleanupStartup();
        tracker.close();
        reject(new Error(event.message || "手部追踪 Worker 初始化失败"));
      };
      const handleAbort = () => {
        cleanupStartup();
        tracker.close();
        reject(new DOMException("手部追踪初始化已取消", "AbortError"));
      };
      worker.addEventListener("message", handleStartup);
      worker.addEventListener("error", handleStartupError);
      signal?.addEventListener("abort", handleAbort, { once: true });
      worker.postMessage({ type: "init", mode });
    });
  }

  get isProcessing() {
    return this.processing;
  }

  setCallbacks(callbacks: TrackerCallbacks) {
    this.callbacks = callbacks;
  }

  process(source: CanvasImageSource, timestamp: number) {
    if (this.closed || this.processing) return false;
    this.processing = true;
    createImageBitmap(source)
      .then((bitmap) => {
        if (this.closed) {
          bitmap.close();
          return;
        }
        this.worker.postMessage({ type: "detect", bitmap, timestamp }, [bitmap]);
      })
      .catch((error) => {
        this.processing = false;
        if (this.closed) return;
        this.callbacks.onError(
          error instanceof Error ? error : new Error("无法复制摄像头画面"),
        );
      });
    return true;
  }

  private readonly handleMessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === "ready") return;
    this.processing = false;
    if (message.type === "error") {
      this.callbacks.onError(new Error(message.message));
      return;
    }
    this.callbacks.onResult(message.frame, message.timestamp);
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    this.processing = false;
    this.callbacks.onError(new Error(event.message || "手部追踪 Worker 运行失败"));
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    this.processing = false;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
  }
}
