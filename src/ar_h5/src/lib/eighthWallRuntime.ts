import * as THREE from "three";
import type { JewelrySceneContext } from "./arRenderer";
import type { ViewportRect } from "../types/ar";
import type {
  XR8Api,
  XR8CameraDirection,
  XR8CameraPixelResult,
  XR8PipelineModule,
  XR8TextureViewport,
} from "../types/eighthWall";

type CameraFrame = {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  mirrored: boolean;
  viewport: ViewportRect | null;
  timestamp: number;
};

export type EighthWallCallbacks = {
  onSceneReady: (context: JewelrySceneContext) => void | Promise<void>;
  onFrame: (frame: CameraFrame) => void;
  onUpdate: (timestamp: number) => void;
  onCanvasSize: (width: number, height: number) => void;
  onCameraStatus: (status: string) => void;
  onError: (error: Error) => void;
};

type XrController = NonNullable<XR8Api["XrController"]>;

const controllerDetachBarriers = new WeakMap<XrController, Promise<void>>();

export function createAbortError() {
  return new DOMException("AR 会话已取消", "AbortError");
}

export function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject<T>(createAbortError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(createAbortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function waitForXR8(signal: AbortSignal) {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR environment"));
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise<XR8Api>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-engine="8thwall"]',
    );
    const script = existingScript ?? document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("xrloaded", handleLoaded);
      script.removeEventListener("error", handleError);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleLoaded = () => {
      cleanup();
      if (window.XR8) {
        resolve(window.XR8);
      } else {
        reject(new Error("8th Wall Engine 加载失败"));
      }
    };
    const handleError = () => {
      cleanup();
      script.remove();
      reject(new Error("8th Wall Engine 资源加载失败"));
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      if (!window.XR8) script.remove();
      reject(new Error("8th Wall Engine 加载超时"));
    }, 20_000);
    window.addEventListener("xrloaded", handleLoaded, { once: true });
    script.addEventListener("error", handleError, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    if (!existingScript) {
      script.src = "/8thwall/xr.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.engine = "8thwall";
      document.head.append(script);
    }
  });
}

export function compactPixels(
  frame: XR8CameraPixelResult,
  target: Uint8ClampedArray<ArrayBuffer> | null,
): Uint8ClampedArray<ArrayBuffer> {
  const packedRowBytes = frame.cols * 4;
  const requiredLength = packedRowBytes * frame.rows;
  const output = target?.length === requiredLength
    ? target
    : new Uint8ClampedArray(requiredLength);
  if (frame.rowBytes === packedRowBytes) {
    output.set(frame.pixels.subarray(0, requiredLength));
    return output;
  }
  for (let row = 0; row < frame.rows; row += 1) {
    const sourceStart = row * frame.rowBytes;
    output.set(
      frame.pixels.subarray(sourceStart, sourceStart + packedRowBytes),
      row * packedRowBytes,
    );
  }
  return output;
}

export function cameraViewportToCss(
  viewport: XR8TextureViewport | undefined,
  canvas: HTMLCanvasElement,
): ViewportRect | null {
  if (
    !viewport
    || !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || !Number.isFinite(viewport.offsetX)
    || !Number.isFinite(viewport.offsetY)
    || viewport.width <= 0
    || viewport.height <= 0
    || canvas.width < 1
    || canvas.height < 1
    || canvas.clientWidth < 1
    || canvas.clientHeight < 1
  ) {
    return null;
  }
  const scaleX = canvas.clientWidth / canvas.width;
  const scaleY = canvas.clientHeight / canvas.height;
  return {
    x: viewport.offsetX * scaleX,
    y: (canvas.height - viewport.offsetY - viewport.height) * scaleY,
    width: viewport.width * scaleX,
    height: viewport.height * scaleY,
  };
}

export class EighthWallRuntime {
  private readonly frameCanvas = document.createElement("canvas");
  private readonly frameContext = this.frameCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  private xr8: XR8Api | null = null;
  private packedPixels: Uint8ClampedArray<ArrayBuffer> | null = null;
  private active = false;
  private generation = 0;
  private lastFrameAt = 0;
  private startupController: AbortController | null = null;

  private isCurrent(generation: number, signal: AbortSignal) {
    return this.active && generation === this.generation && !signal.aborted;
  }

  private assertCurrent(generation: number, signal: AbortSignal) {
    if (!this.isCurrent(generation, signal)) throw createAbortError();
  }

  private async stopAndWaitForDetach(
    controller: XrController,
    signal: AbortSignal,
  ) {
    xr8StopSafely(this.xr8);
    const barrier = controllerDetachBarriers.get(controller);
    if (barrier) await abortable(barrier, signal);
  }

  async start(
    canvas: HTMLCanvasElement,
    direction: XR8CameraDirection,
    callbacks: EighthWallCallbacks,
  ) {
    this.startupController?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    const { signal } = controller;
    this.startupController = controller;
    this.active = true;
    window.THREE = THREE;
    let pipelineAttached = false;
    let settleDetach = () => {};
    try {
      const xr8 = await waitForXR8(signal);
      this.assertCurrent(generation, signal);
      this.xr8 = xr8;
      if (!xr8.XrController) await abortable(xr8.loadChunk("slam"), signal);
      this.assertCurrent(generation, signal);
      if (!xr8.XrController) throw new Error("8th Wall 相机投影模块不可用");
      const xrController = xr8.XrController;

      await this.stopAndWaitForDetach(xrController, signal);
      this.assertCurrent(generation, signal);
      xrController.configure({
        disableWorldTracking: true,
        mirroredDisplay: false,
      });
      xr8.Threejs.configure({ renderCameraTexture: false });
      this.lastFrameAt = 0;

      let detachSettled = false;
      let resolveDetach = () => {};
      const detachBarrier = new Promise<void>((resolve) => {
        resolveDetach = resolve;
      });
      settleDetach = () => {
        if (detachSettled) return;
        detachSettled = true;
        resolveDetach();
        if (controllerDetachBarriers.get(xrController) === detachBarrier) {
          controllerDetachBarriers.delete(xrController);
        }
      };
      controllerDetachBarriers.set(xrController, detachBarrier);

      await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(startupTimeout);
        signal.removeEventListener("abort", handleAbort);
      };
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const handleAbort = () => settleReject(createAbortError());
      const startupTimeout = window.setTimeout(
        () => settleReject(new Error("摄像头启动超时")),
        25_000,
      );
      signal.addEventListener("abort", handleAbort, { once: true });

      const jewelryModule: XR8PipelineModule = {
        name: "jewelry-tryon",
        onAttach: () => {
          pipelineAttached = true;
        },
        onStart: async () => {
          if (!this.isCurrent(generation, signal)) return;
          try {
            const { scene, camera, renderer } = xr8.Threejs.xrScene();
            xrController.updateCameraProjectionMatrix({
              origin: camera.position,
              facing: camera.quaternion,
            });
            await callbacks.onSceneReady({ canvas, scene, camera, renderer });
            this.assertCurrent(generation, signal);
            callbacks.onCanvasSize(canvas.clientWidth, canvas.clientHeight);
            settleResolve();
          } catch (error) {
            if (!this.isCurrent(generation, signal)) {
              settleReject(createAbortError());
              return;
            }
            settleReject(error instanceof Error ? error : new Error("AR 场景初始化失败"));
          }
        },
        onProcessCpu: ({ processGpuResult }) => {
          if (!this.isCurrent(generation, signal) || !this.frameContext) return;
          const now = performance.now();
          if (now - this.lastFrameAt < 42) return;
          const frame = processGpuResult?.camerapixelarray;
          if (!frame?.pixels || frame.cols < 1 || frame.rows < 1) return;
          this.lastFrameAt = now;
          if (this.frameCanvas.width !== frame.cols || this.frameCanvas.height !== frame.rows) {
            this.frameCanvas.width = frame.cols;
            this.frameCanvas.height = frame.rows;
            this.packedPixels = null;
          }
          this.packedPixels = compactPixels(frame, this.packedPixels);
          this.frameContext.putImageData(
            new ImageData(this.packedPixels, frame.cols, frame.rows),
            0,
            0,
          );
          if (process.env.NODE_ENV !== "production") {
            canvas.dataset.cameraFrameSize = `${frame.cols}x${frame.rows}`;
          }
          const displayViewport = cameraViewportToCss(
            processGpuResult?.gltexturerenderer?.viewport,
            canvas,
          );
          if (process.env.NODE_ENV !== "production" && displayViewport) {
            canvas.dataset.cameraViewport = [
              displayViewport.x,
              displayViewport.y,
              displayViewport.width,
              displayViewport.height,
            ].map((value) => value.toFixed(1)).join(",");
          }
          callbacks.onFrame({
            source: this.frameCanvas,
            width: frame.cols,
            height: frame.rows,
            mirrored: false,
            viewport: displayViewport,
            timestamp: now,
          });
        },
        onUpdate: () => {
          if (this.isCurrent(generation, signal)) {
            callbacks.onUpdate(performance.now());
          }
        },
        onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
          if (!this.isCurrent(generation, signal)) return;
          callbacks.onCanvasSize(canvasWidth, canvasHeight);
        },
        onCameraStatusChange: ({ status }) => {
          if (!this.isCurrent(generation, signal)) return;
          canvas.dataset.cameraStatus = status;
          callbacks.onCameraStatus(status);
          if (status === "failed") settleReject(new Error("无法访问摄像头"));
        },
        onException: (error) => {
          if (!this.isCurrent(generation, signal)) return;
          const runtimeError = error instanceof Error ? error : new Error("8th Wall 运行失败");
          callbacks.onError(runtimeError);
          settleReject(runtimeError);
        },
        onDetach: settleDetach,
      };

      xr8.addCameraPipelineModules([
        xr8.GlTextureRenderer.pipelineModule(),
        xr8.Threejs.pipelineModule(),
        xrController.pipelineModule(),
        xr8.CameraPixelArray.pipelineModule({
          luminance: false,
          maxDimension: 640,
        }),
        jewelryModule,
      ]);
      const camera = xr8.XrConfig.camera();
      // XR8 only exposes FRONT/BACK; the engine and browser choose the physical lens.
      xr8.run({
        canvas,
        allowFront: true,
        allowedDevices: xr8.XrConfig.device().ANY,
        cameraConfig: {
          direction: direction === "user" ? camera.FRONT : camera.BACK,
        },
        glContextConfig: {
          alpha: false,
          antialias: true,
          preserveDrawingBuffer: true,
        },
      });
      });
      this.assertCurrent(generation, signal);
      if (this.startupController === controller) this.startupController = null;
    } catch (error) {
      if (!pipelineAttached) settleDetach();
      if (generation === this.generation) {
        this.active = false;
        this.generation += 1;
        xr8StopSafely(this.xr8);
      }
      if (this.startupController === controller) this.startupController = null;
      throw error;
    }
  }

  stop() {
    this.active = false;
    this.generation += 1;
    this.startupController?.abort();
    this.startupController = null;
    xr8StopSafely(this.xr8);
  }

  version() {
    return this.xr8?.version() ?? null;
  }
}

function xr8StopSafely(xr8: XR8Api | null) {
  if (!xr8) return;
  xr8.stop();
  xr8.clearCameraPipelineModules();
}
