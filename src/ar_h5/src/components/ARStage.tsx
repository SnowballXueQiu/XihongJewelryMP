'use client'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  applyArmBoundary,
  ArmBoundaryEstimator,
  stabilizeArmBoundary,
  type ArmBoundary,
} from "../lib/armBoundary";
import {
  calculateFingerPose,
  calculateForearmGuide,
  calculateWristPose,
  HandednessStabilizer,
  PoseSmoother,
} from "../lib/geometry";
import type {
  FaceMode,
  HandFrame,
  JewelryProduct,
  Pose,
  TrackingStatus,
  UserCalibration,
  ViewportMapping,
  ViewportRect,
} from "../types/ar";
import type { XR8CameraDirection } from "../types/eighthWall";
import { shouldRollbackFailedCameraSwitch } from "../lib/cameraSwitch";
import { posePresentationState } from "../lib/trackingPresentation";

export type ARStageHandle = {
  start: () => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
  capture: () => Promise<Blob | null>;
};

type Props = {
  product: JewelryProduct;
  faceMode: FaceMode;
  calibration: UserCalibration;
  occlusion: boolean;
  onStatus: (status: TrackingStatus) => void;
};

type RendererType = import("../lib/arRenderer").JewelryRenderer;
type RuntimeType = import("../lib/eighthWallRuntime").EighthWallRuntime;
type TrackerType = import("../lib/handTracker").BrowserHandTracker;
type SegmenterType = import("../lib/skinSegmenter").BodySkinSegmenter;

type TrackingInput = {
  source: CanvasImageSource;
  width: number;
  height: number;
  mirrored: boolean;
  viewport: ViewportRect | null;
  timestamp: number;
  epoch: number;
};

const QA_IMAGES = {
  side: "/qa/fixtures/side.png",
  back: "/qa/fixtures/back.png",
  "palm-fist": "/qa/fixtures/palm-fist.png",
  "palm-open": "/qa/fixtures/palm-open.png",
  "back-fist": "/qa/fixtures/back-fist.png",
  horizontal: "/qa/fixtures/horizontal.png",
  forearm: "/qa/fixtures/forearm.png",
  mobile: "/qa/fixtures/mobile.png",
  "bent-back": "/qa/fixtures/bent-back.jpg",
  "bent-palm": "/qa/fixtures/bent-palm.jpg",
  "bent-horizontal": "/qa/fixtures/bent-horizontal.jpg",
} as const;

type QaImageKey = keyof typeof QA_IMAGES;
const qaKey = typeof window !== "undefined"
  ? (new URLSearchParams(window.location.search).get("qa") as QaImageKey | null)
  : null;
const QA_IMAGE_URL = process.env.NODE_ENV !== "production" && qaKey && qaKey in QA_IMAGES
  ? QA_IMAGES[qaKey as QaImageKey]
  : null;
const QA_IMAGE_MODE = QA_IMAGE_URL !== null;

function cancelledSession() {
  return new DOMException("AR 会话已取消", "AbortError");
}

function isCancelledSession(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject<T>(cancelledSession());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(cancelledSession());
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

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function primeCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const displayWidth = Math.max(1, Math.round(width));
  const displayHeight = Math.max(1, Math.round(height));
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  canvas.width = Math.round(displayWidth * pixelRatio);
  canvas.height = Math.round(displayHeight * pixelRatio);
}

function trackingCopy(product: JewelryProduct) {
  return product.anchor === "finger"
    ? { tracking: "已贴合手指", searching: "将手指放入取景框", lost: "请保持手指在画面内" }
    : { tracking: "已贴合手腕", searching: "将手腕放入取景框", lost: "请保持手腕在画面内" };
}

export const ARStage = forwardRef<ARStageHandle, Props>(function ARStage(
  { product, faceMode, calibration, occlusion, onStatus },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererType | null>(null);
  const runtimeRef = useRef<RuntimeType | null>(null);
  const trackerRef = useRef<TrackerType | null>(null);
  const segmenterRef = useRef<SegmenterType | null>(null);
  const qaAnimationRef = useRef(0);
  const [cameraDirection, setCameraDirection] = useState<XR8CameraDirection>("user");
  const activeRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const switchPromiseRef = useRef<Promise<void> | null>(null);
  const trackingInputRef = useRef<TrackingInput | null>(null);
  const directionRef = useRef<XR8CameraDirection>("user");
  const productRef = useRef(product);
  const faceModeRef = useRef(faceMode);
  const calibrationRef = useRef(calibration);
  const occlusionRef = useRef(occlusion);
  const statusRef = useRef<TrackingStatus>({ phase: "idle", message: "准备试戴" });
  const smootherRef = useRef(new PoseSmoother());
  const handednessRef = useRef(new HandednessStabilizer());
  const boundaryEstimatorRef = useRef(new ArmBoundaryEstimator());
  const boundaryRef = useRef<{ value: ArmBoundary; timestamp: number } | null>(null);
  const poseRef = useRef<Pose | null>(null);
  const qaFrameRef = useRef<HandFrame | null>(null);
  const qaDetectionCompleteRef = useRef(false);
  const lastSeenRef = useRef(0);
  const validFramesRef = useRef(0);
  const lastBoundaryInferenceRef = useRef(0);
  const segmentationGenerationRef = useRef(0);
  const segmentationErrorReportedRef = useRef(false);
  const lastStatusUpdateRef = useRef(0);
  const frameCounterRef = useRef({ count: 0, since: 0, fps: 0 });

  productRef.current = product;
  faceModeRef.current = faceMode;
  calibrationRef.current = calibration;
  occlusionRef.current = occlusion;

  const publishStatus = useCallback(
    (next: TrackingStatus, force = false) => {
      const now = performance.now();
      const previous = statusRef.current;
      if (
        !force
        && previous.phase === next.phase
        && previous.message === next.message
        && now - lastStatusUpdateRef.current < 700
      ) {
        return;
      }
      statusRef.current = next;
      lastStatusUpdateRef.current = now;
      onStatus(next);
    },
    [onStatus],
  );

  const resetTracking = useCallback(() => {
    poseRef.current = null;
    qaFrameRef.current = null;
    qaDetectionCompleteRef.current = false;
    boundaryRef.current = null;
    lastSeenRef.current = 0;
    validFramesRef.current = 0;
    lastBoundaryInferenceRef.current = 0;
    segmentationGenerationRef.current += 1;
    smootherRef.current.reset();
    handednessRef.current.reset();
  }, []);

  const resizeRenderer = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !rendererRef.current) return;
    rendererRef.current.resize(stage.clientWidth, stage.clientHeight);
  }, []);

  const recordBoundaryDiagnostics = useCallback(() => {
    const diagnostics = boundaryEstimatorRef.current.getDiagnostics();
    const canvas = canvasRef.current;
    if (!diagnostics || !canvas) return;
    canvas.dataset.skinMaskSize = diagnostics.maskSize?.join("x") ?? "none";
    canvas.dataset.skinWristConfidence = diagnostics.wristConfidence?.toFixed(3) ?? "none";
    canvas.dataset.skinCenterConfidence = diagnostics.centerConfidence?.toFixed(3) ?? "none";
    canvas.dataset.initialArmAxis = `${diagnostics.initialAxis.x.toFixed(3)},${diagnostics.initialAxis.y.toFixed(3)}`;
    canvas.dataset.refinedArmAxis = `${diagnostics.refinedAxis.x.toFixed(3)},${diagnostics.refinedAxis.y.toFixed(3)}`;
  }, []);

  const consumeFrame = useCallback((
    frame: HandFrame | null,
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    mirrored: boolean,
    viewport: ViewportRect | null,
    timestamp: number,
  ) => {
    frameCounterRef.current.count += 1;
    const stage = stageRef.current;
    if (!frame || !stage || sourceWidth < 1 || sourceHeight < 1) return;

    const mapping: ViewportMapping = {
      sourceWidth,
      sourceHeight,
      width: stage.clientWidth,
      height: stage.clientHeight,
      mirrored,
      viewport,
    };
    const stableHandedness = handednessRef.current.update(frame.handedness, frame.score);
    const currentProduct = productRef.current;
    let pose = currentProduct.anchor === "finger"
      ? calculateFingerPose(
          frame.landmarks,
          frame.worldLandmarks,
          mapping,
          stableHandedness,
          currentProduct.finger ?? "ring",
          frame.score,
        )
      : calculateWristPose(
          frame.landmarks,
          frame.worldLandmarks,
          mapping,
          stableHandedness,
          frame.score,
        );
    const canvas = canvasRef.current;
    if (process.env.NODE_ENV !== "production" && canvas) {
      canvas.dataset.poseCandidate = pose ? "valid" : "invalid";
    }
    if (!pose) return;

    if (
      currentProduct.anchor === "wrist"
      && timestamp - lastBoundaryInferenceRef.current >= 125
    ) {
      const guide = calculateForearmGuide(frame.landmarks, mapping);
      const segmenter = segmenterRef.current;
      if (guide && !segmenter?.isProcessing) {
        const analysis = boundaryEstimatorRef.current.prepare(
          source,
          stage.clientWidth,
          stage.clientHeight,
          mirrored,
          viewport,
        );
        if (analysis) {
          lastBoundaryInferenceRef.current = timestamp;
          const candidatePose = { x: pose.x, y: pose.y, scale: pose.scale };
          const generation = segmentationGenerationRef.current;
          const applyMeasurement = (
            skinMask: Awaited<ReturnType<SegmenterType["segment"]>>,
          ) => {
            if (!activeRef.current || generation !== segmentationGenerationRef.current) return;
            const currentPose = poseRef.current;
            const latency = performance.now() - timestamp;
            const movement = currentPose
              ? Math.hypot(currentPose.x - candidatePose.x, currentPose.y - candidatePose.y)
              : 0;
            if (latency > 280 || movement > Math.max(18, candidatePose.scale * 0.45)) return;
            const boundary = boundaryEstimatorRef.current.estimate(
              analysis,
              guide,
              candidatePose.scale,
              skinMask,
            );
            recordBoundaryDiagnostics();
            if (boundary) {
              const now = performance.now();
              const previousBoundary = boundaryRef.current
                && now - boundaryRef.current.timestamp < 450
                ? boundaryRef.current.value
                : null;
              const stableBoundary = stabilizeArmBoundary(
                boundary,
                candidatePose,
                previousBoundary,
              );
              if (stableBoundary) {
                boundaryRef.current = { value: stableBoundary, timestamp: now };
              }
            }
          };

          if (segmenter) {
            segmenter.segment(analysis.source, timestamp)?.then(applyMeasurement).catch((error) => {
              if (!activeRef.current || generation !== segmentationGenerationRef.current) return;
              if (!segmentationErrorReportedRef.current) {
                console.warn("Body-skin segmentation unavailable; using color fallback.", error);
                segmentationErrorReportedRef.current = true;
              }
              applyMeasurement(null);
            });
          } else {
            applyMeasurement(null);
          }
        }
      }
    }

    if (boundaryRef.current && (QA_IMAGE_MODE || timestamp - boundaryRef.current.timestamp < 450)) {
      pose = applyArmBoundary(
        pose,
        boundaryRef.current.value,
        1,
        currentProduct.calibration.modelPlaneSize,
      );
    }
    poseRef.current = smootherRef.current.update(pose, timestamp);
    if (process.env.NODE_ENV !== "production" && canvas) {
      canvas.dataset.poseAcceptedAt = timestamp.toFixed(1);
      canvas.dataset.poseX = pose.x.toFixed(1);
      canvas.dataset.poseY = pose.y.toFixed(1);
      canvas.dataset.rawPoseScale = pose.scale.toFixed(1);
    }
    validFramesRef.current = QA_IMAGE_MODE ? 2 : validFramesRef.current + 1;
    lastSeenRef.current = timestamp;
  }, [recordBoundaryDiagnostics]);

  const updatePresentation = useCallback((timestamp: number) => {
    if (!activeRef.current) return;
    const presentation = posePresentationState(
      validFramesRef.current,
      lastSeenRef.current,
      timestamp,
      poseRef.current !== null,
    );
    const { elapsed, opacity } = presentation;
    const canvas = canvasRef.current;
    if (process.env.NODE_ENV !== "production" && canvas) {
      canvas.dataset.poseAvailable = String(poseRef.current !== null);
      canvas.dataset.poseElapsed = Number.isFinite(elapsed) ? elapsed.toFixed(1) : "none";
      canvas.dataset.presentationAt = timestamp.toFixed(1);
    }
    if (presentation.shouldReset) {
      poseRef.current = null;
      validFramesRef.current = 0;
      smootherRef.current.reset();
    }
    rendererRef.current?.render(
      presentation.confirmed ? poseRef.current : null,
      faceModeRef.current,
      calibrationRef.current,
      opacity,
      occlusionRef.current,
    );

    const counter = frameCounterRef.current;
    if (timestamp - counter.since >= 1000) {
      counter.fps = Math.round((counter.count * 1000) / Math.max(1, timestamp - counter.since));
      counter.count = 0;
      counter.since = timestamp;
    }
    const copy = trackingCopy(productRef.current);
    if (presentation.confirmed && elapsed <= 100) {
      publishStatus({
        phase: "tracking",
        message: copy.tracking,
        fps: counter.fps,
        facing: poseRef.current?.frontFacing ? "front" : "back",
      });
    } else if (presentation.confirmed && poseRef.current && elapsed < 450) {
      publishStatus({ phase: "lost", message: copy.lost, fps: counter.fps });
    } else {
      publishStatus({ phase: "searching", message: copy.searching, fps: counter.fps });
    }
  }, [publishStatus]);

  const isSessionCurrent = useCallback(
    (epoch: number) => activeRef.current && sessionEpochRef.current === epoch,
    [],
  );

  const failSession = useCallback((
    epoch: number,
    message: string,
    closeTracker = false,
  ) => {
    if (!isSessionCurrent(epoch)) return;
    sessionEpochRef.current += 1;
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    activeRef.current = false;
    startPromiseRef.current = null;
    switchPromiseRef.current = null;
    trackingInputRef.current = null;
    cancelAnimationFrame(qaAnimationRef.current);
    runtimeRef.current?.stop();
    rendererRef.current?.dispose();
    rendererRef.current = null;
    if (closeTracker) {
      trackerRef.current?.close();
      trackerRef.current = null;
    }
    resetTracking();
    publishStatus({ phase: "error", message }, true);
  }, [isSessionCurrent, publishStatus, resetTracking]);

  const handleTrackingResult = useCallback((frame: HandFrame | null, timestamp: number) => {
    const input = trackingInputRef.current;
    if (
      !input
      || input.timestamp !== timestamp
      || !isSessionCurrent(input.epoch)
    ) {
      return;
    }
    const canvas = canvasRef.current;
    if (process.env.NODE_ENV !== "production" && canvas) {
      const resultCount = Number(canvas.dataset.trackingResults ?? 0) + 1;
      canvas.dataset.trackingResults = String(resultCount);
      canvas.dataset.trackingResult = frame ? "hand" : "none";
      canvas.dataset.trackingInferenceMs = (performance.now() - timestamp).toFixed(1);
      if (frame) canvas.dataset.handScore = frame.score.toFixed(3);
    }
    if (QA_IMAGE_MODE) {
      qaFrameRef.current = frame;
      qaDetectionCompleteRef.current = true;
      return;
    }
    consumeFrame(
      frame,
      input.source,
      input.width,
      input.height,
      input.mirrored,
      input.viewport,
      timestamp,
    );
  }, [consumeFrame, isSessionCurrent]);

  const handleTrackingError = useCallback((error: Error) => {
    const input = trackingInputRef.current;
    if (!input || !isSessionCurrent(input.epoch)) return;
    console.error(error);
    failSession(input.epoch, "手部追踪暂时不可用", true);
  }, [failSession, isSessionCurrent]);

  const startLiveRuntime = useCallback(async (
    epoch: number,
    direction: XR8CameraDirection,
  ) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) throw new Error("AR 画布初始化失败");
    primeCanvasSize(canvas, stage.clientWidth, stage.clientHeight);
    const [{ JewelryRenderer }, { EighthWallRuntime }] = await Promise.all([
      import("../lib/arRenderer"),
      import("../lib/eighthWallRuntime"),
    ]);
    if (!isSessionCurrent(epoch)) throw cancelledSession();
    const runtime = runtimeRef.current ?? new EighthWallRuntime();
    runtimeRef.current = runtime;
    await runtime.start(canvas, direction, {
      onSceneReady: async (context) => {
        if (!isSessionCurrent(epoch)) throw cancelledSession();
        rendererRef.current?.dispose();
        const renderer = new JewelryRenderer(context);
        rendererRef.current = renderer;
        resizeRenderer();
        try {
          await renderer.setProduct(productRef.current);
          if (!isSessionCurrent(epoch)) throw cancelledSession();
          canvas.dataset.xr8Version = runtime.version() ?? "unknown";
        } catch (error) {
          if (rendererRef.current === renderer) {
            rendererRef.current = null;
            renderer.dispose();
          }
          throw error;
        }
      },
      onFrame: ({ source, width, height, mirrored, viewport, timestamp }) => {
        if (!isSessionCurrent(epoch)) return;
        const tracker = trackerRef.current;
        if (tracker?.process(source, timestamp)) {
          if (process.env.NODE_ENV !== "production") {
            canvas.dataset.trackingFrames = String(
              Number(canvas.dataset.trackingFrames ?? 0) + 1,
            );
          }
          trackingInputRef.current = {
            source,
            width,
            height,
            mirrored,
            viewport,
            timestamp,
            epoch,
          };
        }
      },
      onUpdate: (timestamp) => {
        if (isSessionCurrent(epoch)) updatePresentation(timestamp);
      },
      onCanvasSize: () => {
        if (isSessionCurrent(epoch)) {
          resizeRenderer();
        }
      },
      onCameraStatus: (cameraStatus) => {
        if (!isSessionCurrent(epoch)) return;
        if (cameraStatus === "requesting") {
          publishStatus({ phase: "loading", message: "正在请求摄像头" }, true);
        } else if (cameraStatus === "failed") {
          failSession(epoch, "无法访问摄像头");
        }
      },
      onError: (error) => {
        failSession(epoch, error.message);
      },
    });
    if (!isSessionCurrent(epoch)) throw cancelledSession();
  }, [failSession, isSessionCurrent, publishStatus, resizeRenderer, updatePresentation]);

  const startQaLoop = useCallback((epoch: number) => {
    const tick = (timestamp: number) => {
      if (!isSessionCurrent(epoch)) return;
      const image = imageRef.current;
      const tracker = trackerRef.current;
      if (
        image
        && tracker
        && image.naturalWidth > 0
        && !qaDetectionCompleteRef.current
        && tracker.process(image, timestamp)
      ) {
        trackingInputRef.current = {
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          mirrored: false,
          viewport: null,
          timestamp,
          epoch,
        };
      }
      if (image && qaFrameRef.current && image.naturalWidth > 0) {
        consumeFrame(
          qaFrameRef.current,
          image,
          image.naturalWidth,
          image.naturalHeight,
          false,
          null,
          timestamp,
        );
      }
      updatePresentation(timestamp);
      qaAnimationRef.current = requestAnimationFrame(tick);
    };
    qaAnimationRef.current = requestAnimationFrame(tick);
  }, [consumeFrame, isSessionCurrent, updatePresentation]);

  const stop = useCallback(() => {
    sessionEpochRef.current += 1;
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    activeRef.current = false;
    startPromiseRef.current = null;
    switchPromiseRef.current = null;
    trackingInputRef.current = null;
    cancelAnimationFrame(qaAnimationRef.current);
    runtimeRef.current?.stop();
    rendererRef.current?.dispose();
    rendererRef.current = null;
    resetTracking();
    publishStatus({ phase: "idle", message: "试戴已暂停" }, true);
  }, [publishStatus, resetTracking]);

  const start = useCallback(() => {
    if (startPromiseRef.current) return startPromiseRef.current;
    if (activeRef.current) return Promise.resolve();

    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    const epoch = ++sessionEpochRef.current;
    const operation = (async () => {
      const created: { tracker?: TrackerType; segmenter?: SegmenterType } = {};
      try {
        publishStatus({ phase: "loading", message: "正在准备 AR" }, true);
        activeRef.current = true;
        if (!QA_IMAGE_MODE && !window.isSecureContext && location.hostname !== "localhost") {
          throw new Error("摄像头需要通过 HTTPS 打开");
        }
        trackingInputRef.current = null;
        resetTracking();
        segmentationErrorReportedRef.current = false;
        const now = performance.now();
        frameCounterRef.current = { count: 0, since: now, fps: 0 };

        const trackerPromise = trackerRef.current
          ? Promise.resolve(trackerRef.current)
          : import("../lib/handTracker")
              .then(({ BrowserHandTracker }) => BrowserHandTracker.create(
                QA_IMAGE_MODE ? "IMAGE" : "VIDEO",
                { onResult: handleTrackingResult, onError: handleTrackingError },
                controller.signal,
              ))
              .then((tracker) => {
                if (controller.signal.aborted || sessionEpochRef.current !== epoch) {
                  tracker.close();
                  throw cancelledSession();
                }
                created.tracker = tracker;
                return tracker;
              });
        const segmenterPromise = segmenterRef.current
          ? Promise.resolve(segmenterRef.current)
          : import("../lib/skinSegmenter")
              .then(({ BodySkinSegmenter }) =>
                BodySkinSegmenter.create(
                  QA_IMAGE_MODE ? "IMAGE" : "VIDEO",
                  controller.signal,
                ),
              )
              .then((segmenter) => {
                if (controller.signal.aborted || sessionEpochRef.current !== epoch) {
                  segmenter.close();
                  throw cancelledSession();
                }
                created.segmenter = segmenter;
                return segmenter;
              })
              .catch((error) => {
                if (isCancelledSession(error)) throw error;
                console.warn("Body-skin segmentation unavailable; using color fallback.", error);
                return null;
              });

        const [tracker, segmenter] = await abortable(
          Promise.all([trackerPromise, segmenterPromise]),
          controller.signal,
        );
        if (!isSessionCurrent(epoch)) {
          throw cancelledSession();
        }
        tracker.setCallbacks({ onResult: handleTrackingResult, onError: handleTrackingError });
        trackerRef.current = tracker;
        segmenterRef.current = segmenter;

        if (QA_IMAGE_MODE) {
          const canvas = canvasRef.current;
          const image = imageRef.current;
          if (!canvas || !image) throw new Error("QA 画面初始化失败");
          await abortable(image.decode(), controller.signal);
          if (!isSessionCurrent(epoch)) throw cancelledSession();
          const { JewelryRenderer } = await abortable(
            import("../lib/arRenderer"),
            controller.signal,
          );
          if (!isSessionCurrent(epoch)) throw cancelledSession();
          const renderer = new JewelryRenderer(canvas);
          rendererRef.current = renderer;
          resizeRenderer();
          await abortable(renderer.setProduct(productRef.current), controller.signal);
          if (!isSessionCurrent(epoch)) throw cancelledSession();
          startQaLoop(epoch);
        } else {
          await startLiveRuntime(epoch, directionRef.current);
        }
        if (!isSessionCurrent(epoch)) throw cancelledSession();
        publishStatus({
          phase: "searching",
          message: trackingCopy(productRef.current).searching,
        }, true);
      } catch (error) {
        if (created.tracker && trackerRef.current !== created.tracker) {
          created.tracker.close();
        }
        if (created.segmenter && segmenterRef.current !== created.segmenter) {
          created.segmenter.close();
        }
        if (isSessionCurrent(epoch)) {
          controller.abort();
          if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
          activeRef.current = false;
          runtimeRef.current?.stop();
          rendererRef.current?.dispose();
          rendererRef.current = null;
          trackingInputRef.current = null;
          resetTracking();
          const message = error instanceof Error ? error.message : "AR 初始化失败";
          publishStatus({ phase: "error", message }, true);
        }
        throw error;
      } finally {
        if (sessionEpochRef.current === epoch) startPromiseRef.current = null;
      }
    })();
    startPromiseRef.current = operation;
    return operation;
  }, [
    handleTrackingError,
    handleTrackingResult,
    isSessionCurrent,
    publishStatus,
    resetTracking,
    resizeRenderer,
    startLiveRuntime,
    startQaLoop,
  ]);

  const switchCamera = useCallback(() => {
    if (QA_IMAGE_MODE) return Promise.resolve();
    if (switchPromiseRef.current) return switchPromiseRef.current;
    const previousDirection = directionRef.current;
    const nextDirection = previousDirection === "user" ? "environment" : "user";
    if (!activeRef.current) {
      directionRef.current = nextDirection;
      setCameraDirection(nextDirection);
      return Promise.resolve();
    }

    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    const epoch = ++sessionEpochRef.current;
    directionRef.current = nextDirection;
    setCameraDirection(nextDirection);
    publishStatus({ phase: "loading", message: "正在切换摄像头" }, true);
    trackingInputRef.current = null;
    runtimeRef.current?.stop();
    rendererRef.current?.dispose();
    rendererRef.current = null;
    resetTracking();

    const operation = (async () => {
      try {
        await startLiveRuntime(epoch, nextDirection);
        if (!isSessionCurrent(epoch)) throw cancelledSession();
        publishStatus({
          phase: "searching",
          message: trackingCopy(productRef.current).searching,
        }, true);
      } catch (error) {
        const ownsActiveSession = isSessionCurrent(epoch);
        const shouldRollbackDirection = shouldRollbackFailedCameraSwitch({
          active: activeRef.current,
          currentEpoch: sessionEpochRef.current,
          switchEpoch: epoch,
          currentDirection: directionRef.current,
          failedDirection: nextDirection,
        });
        if (ownsActiveSession) {
          controller.abort();
          if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
          activeRef.current = false;
          runtimeRef.current?.stop();
          rendererRef.current?.dispose();
          rendererRef.current = null;
          trackingInputRef.current = null;
          resetTracking();
          const message = error instanceof Error ? error.message : "摄像头切换失败";
          publishStatus({ phase: "error", message }, true);
        }
        if (shouldRollbackDirection) {
          directionRef.current = previousDirection;
          setCameraDirection(previousDirection);
        }
        throw error;
      } finally {
        if (sessionEpochRef.current === epoch) switchPromiseRef.current = null;
      }
    })();
    switchPromiseRef.current = operation;
    return operation;
  }, [isSessionCurrent, publishStatus, resetTracking, startLiveRuntime]);

  const capture = useCallback(async () => {
    const stage = stageRef.current;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return null;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const width = Math.round(stage.clientWidth * pixelRatio);
    const height = Math.round(stage.clientHeight * pixelRatio);
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#5d625f";
    context.fillRect(0, 0, width, height);
    if (QA_IMAGE_MODE && image?.naturalWidth && image.naturalHeight) {
      drawCover(context, image, image.naturalWidth, image.naturalHeight, width, height);
    }
    context.drawImage(canvas, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png", 0.96));
  }, []);

  useImperativeHandle(ref, () => ({ start, stop, switchCamera, capture }), [
    capture,
    start,
    stop,
    switchCamera,
  ]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(resizeRenderer);
    if (stageRef.current) resizeObserver.observe(stageRef.current);
    return () => resizeObserver.disconnect();
  }, [resizeRenderer]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && activeRef.current) stop();
    };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [stop]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const epoch = sessionEpochRef.current;
    if (!renderer || !activeRef.current) return;
    renderer.setProduct(product).catch((error) => {
      if (!isSessionCurrent(epoch) || rendererRef.current !== renderer) return;
      console.error(error);
      failSession(epoch, "首饰模型加载失败");
    });
  }, [failSession, isSessionCurrent, product]);

  useEffect(
    () => () => {
      sessionEpochRef.current += 1;
      sessionAbortRef.current?.abort();
      sessionAbortRef.current = null;
      activeRef.current = false;
      trackingInputRef.current = null;
      cancelAnimationFrame(qaAnimationRef.current);
      runtimeRef.current?.stop();
      trackerRef.current?.close();
      segmenterRef.current?.close();
      rendererRef.current?.dispose();
    },
    [],
  );

  return (
    <div
      ref={stageRef}
      className="ar-stage"
      data-engine={QA_IMAGE_MODE ? "fixture" : "8thwall"}
      data-qa-image={qaKey ?? undefined}
      data-camera-direction={cameraDirection}
      data-preview-mirrored="false"
    >
      {QA_IMAGE_URL ? (
        <img ref={imageRef} className="camera-feed" src={QA_IMAGE_URL} alt="手部追踪测试画面" />
      ) : null}
      <canvas ref={canvasRef} className="jewelry-canvas" aria-label="AR 首饰渲染画布" />
    </div>
  );
});
