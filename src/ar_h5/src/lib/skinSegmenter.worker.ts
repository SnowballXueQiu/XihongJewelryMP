/// <reference lib="webworker" />

import type { ImageSegmenter, ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { SegmenterMode } from "./skinSegmenter";

declare const self: DedicatedWorkerGlobalScope;

const WASM_LOADER_PATH = "/mediapipe/wasm/vision_wasm_module_internal.js";
const WASM_BINARY_PATH = "/mediapipe/wasm/vision_wasm_module_internal.wasm";
const MODEL_PATH = "/mediapipe/selfie_multiclass_256x256.tflite";
const BODY_SKIN_LABEL = "body-skin";

let detector: ImageSegmenter | null = null;
let mode: SegmenterMode = "VIDEO";
let bodySkinIndex = -1;

async function initialize(nextMode: SegmenterMode) {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = {
    wasmLoaderPath: WASM_LOADER_PATH,
    wasmBinaryPath: WASM_BINARY_PATH,
  };
  mode = nextMode;
  const options = {
    baseOptions: {
      modelAssetPath: MODEL_PATH,
      delegate: "GPU" as const,
    },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: mode,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  };

  try {
    detector = await vision.ImageSegmenter.createFromOptions(fileset, options);
  } catch (gpuError) {
    console.warn("GPU skin segmentation unavailable; falling back to CPU.", gpuError);
    detector = await vision.ImageSegmenter.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      canvas: undefined,
    });
  }

  const labels = detector.getLabels();
  bodySkinIndex = labels.findIndex(
    (label) => label.trim().toLowerCase() === BODY_SKIN_LABEL,
  );
  if (bodySkinIndex < 0) {
    throw new Error(`Selfie Multiclass 模型缺少 ${BODY_SKIN_LABEL} 类别`);
  }
}

function segment(bitmap: ImageBitmap, timestamp: number) {
  if (!detector) throw new Error("皮肤分割器尚未初始化");
  let delivered = false;
  const consume = (result: ImageSegmenterResult) => {
    try {
      const mask = result.confidenceMasks?.[bodySkinIndex];
      if (!mask) return;
      const data = new Float32Array(mask.getAsFloat32Array());
      self.postMessage(
        {
          type: "result",
          timestamp,
          width: mask.width,
          height: mask.height,
          data,
        },
        [data.buffer],
      );
      delivered = true;
    } finally {
      result.close();
    }
  };

  try {
    if (mode === "VIDEO") detector.segmentForVideo(bitmap, timestamp, consume);
    else detector.segment(bitmap, consume);
    if (!delivered) {
      self.postMessage({ type: "result", timestamp, width: 0, height: 0, data: null });
    }
  } finally {
    bitmap.close();
  }
}

self.addEventListener("message", async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      await initialize(message.mode);
      self.postMessage({ type: "ready" });
    } else if (message.type === "segment") {
      segment(message.bitmap, message.timestamp);
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : "皮肤分割失败";
    if (message.bitmap instanceof ImageBitmap) message.bitmap.close();
    if (typeof message.timestamp === "number") {
      self.postMessage({
        type: "result",
        timestamp: message.timestamp,
        width: 0,
        height: 0,
        data: null,
      });
    } else {
      self.postMessage({ type: "error", message: text });
    }
  }
});

self.addEventListener("close", () => detector?.close());

export {};
