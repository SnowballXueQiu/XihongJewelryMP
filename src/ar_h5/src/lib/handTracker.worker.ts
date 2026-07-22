/// <reference lib="webworker" />

import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { HandFrame, Landmark } from "../types/ar";
import { unmirroredMediaPipeHandedness } from "./handSemantics";
import type { TrackerMode } from "./handTracker";

declare const self: DedicatedWorkerGlobalScope;

const WASM_LOADER_PATH = "/mediapipe/wasm/vision_wasm_module_internal.js";
const WASM_BINARY_PATH = "/mediapipe/wasm/vision_wasm_module_internal.wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker.task";

let detector: HandLandmarker | null = null;
let mode: TrackerMode = "VIDEO";

async function initialize(nextMode: TrackerMode) {
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
    numHands: 1,
    minHandDetectionConfidence: 0.38,
    minHandPresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
  };

  try {
    detector = await vision.HandLandmarker.createFromOptions(fileset, options);
  } catch (gpuError) {
    console.warn("GPU hand tracking unavailable; falling back to CPU.", gpuError);
    detector = await vision.HandLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      canvas: undefined,
    });
  }
}

function copyLandmarks(points: HandLandmarkerResult["landmarks"][number] | undefined) {
  return points?.map((point): Landmark => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  }));
}

function toFrame(result: HandLandmarkerResult, timestamp: number): HandFrame | null {
  const landmarks = copyLandmarks(result.landmarks[0]);
  if (!landmarks) return null;
  const category = result.handedness[0]?.[0];
  return {
    landmarks,
    worldLandmarks: copyLandmarks(result.worldLandmarks[0]),
    handedness: unmirroredMediaPipeHandedness(category?.categoryName),
    score: category?.score ?? 0.5,
    timestamp,
  };
}

function detect(bitmap: ImageBitmap, timestamp: number) {
  if (!detector) throw new Error("手部追踪器尚未初始化");
  try {
    const result = mode === "VIDEO"
      ? detector.detectForVideo(bitmap, timestamp)
      : detector.detect(bitmap);
    self.postMessage({ type: "result", frame: toFrame(result, timestamp), timestamp });
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
    } else if (message.type === "detect") {
      detect(message.bitmap, message.timestamp);
    }
  } catch (error) {
    if (message.bitmap instanceof ImageBitmap) message.bitmap.close();
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "手部追踪失败",
    });
  }
});

self.addEventListener("close", () => detector?.close());

export {};
