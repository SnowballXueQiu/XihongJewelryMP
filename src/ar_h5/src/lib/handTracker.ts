import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { HandFrame, Handedness, Landmark } from "../types/ar";

const WASM_ROOT = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker.task";
export type TrackerMode = "IMAGE" | "VIDEO";

export class BrowserHandTracker {
  private constructor(
    private readonly detector: HandLandmarker,
    private readonly mode: TrackerMode,
  ) {}

  static async create(mode: TrackerMode = "VIDEO") {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
    const options = {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: "GPU" as const,
      },
      runningMode: mode,
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      const detector = await vision.HandLandmarker.createFromOptions(fileset, options);
      return new BrowserHandTracker(detector, mode);
    } catch (gpuError) {
      console.warn("GPU hand tracking unavailable; falling back to CPU.", gpuError);
      const detector = await vision.HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      });
      return new BrowserHandTracker(detector, mode);
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): HandFrame | null {
    if (this.mode !== "VIDEO") return null;
    const result = this.detector.detectForVideo(video, timestamp);
    return this.toFrame(result, timestamp);
  }

  detectImage(image: HTMLImageElement, timestamp: number): HandFrame | null {
    if (this.mode !== "IMAGE") return null;
    const result = this.detector.detect(image);
    return this.toFrame(result, timestamp);
  }

  private toFrame(result: HandLandmarkerResult, timestamp: number): HandFrame | null {
    const landmarks = result.landmarks[0] as Landmark[] | undefined;
    if (!landmarks) return null;

    const category = result.handedness[0]?.[0];
    const handedness = (category?.categoryName ?? "Unknown") as Handedness;

    return {
      landmarks,
      worldLandmarks: result.worldLandmarks[0] as Landmark[] | undefined,
      handedness,
      score: category?.score ?? 0.5,
      timestamp,
    };
  }

  close() {
    this.detector.close();
  }
}
