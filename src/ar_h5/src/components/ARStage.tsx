import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type {
  FaceMode,
  JewelryProduct,
  Pose,
  TrackingStatus,
  UserCalibration,
  ViewportMapping,
} from "../types/ar";
import {
  calculateFingerPose,
  calculateForearmGuide,
  calculateWristPose,
  PoseSmoother,
} from "../lib/geometry";
import {
  applyArmBoundary,
  ArmBoundaryEstimator,
  type ArmBoundary,
} from "../lib/armBoundary";

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
type TrackerType = import("../lib/handTracker").BrowserHandTracker;

const QA_IMAGES = {
  side: "/qa/fixtures/side.png",
  back: "/qa/fixtures/back.png",
  "palm-fist": "/qa/fixtures/palm-fist.png",
  "palm-open": "/qa/fixtures/palm-open.png",
  "back-fist": "/qa/fixtures/back-fist.png",
  horizontal: "/qa/fixtures/horizontal.png",
  forearm: "/qa/fixtures/forearm.png",
  mobile: "/qa/fixtures/mobile.png",
} as const;
type QaImageKey = keyof typeof QA_IMAGES;
const qaKey = new URLSearchParams((typeof window !== 'undefined' ? window.location.search : '')).get("qa") as QaImageKey | null;
const QA_IMAGE_URL = process.env.NODE_ENV !== 'production' && qaKey && qaKey in QA_IMAGES
  ? QA_IMAGES[qaKey]
  : null;
const QA_IMAGE_MODE = QA_IMAGE_URL !== null;

function drawCover(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mirrored: boolean,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  if (mirrored) {
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(source, x, y, drawWidth, drawHeight);
    context.restore();
    return;
  }
  context.drawImage(source, x, y, drawWidth, drawHeight);
}

export const ARStage = forwardRef<ARStageHandle, Props>(function ARStage(
  { product, faceMode, calibration, occlusion, onStatus },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererType | null>(null);
  const trackerRef = useRef<TrackerType | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const activeRef = useRef(false);
  const facingRef = useRef<"user" | "environment">("environment");
  const productRef = useRef(product);
  const faceModeRef = useRef(faceMode);
  const calibrationRef = useRef(calibration);
  const occlusionRef = useRef(occlusion);
  const statusRef = useRef<TrackingStatus>({ phase: "idle", message: "准备试戴" });
  const smootherRef = useRef(new PoseSmoother());
  const boundaryEstimatorRef = useRef(new ArmBoundaryEstimator());
  const boundaryRef = useRef<{ value: ArmBoundary; timestamp: number } | null>(null);
  const qaFrameRef = useRef<ReturnType<TrackerType["detectImage"]>>(null);
  const qaDetectionCompleteRef = useRef(false);
  const poseRef = useRef<Pose | null>(null);
  const lastSeenRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const lastBoundaryInferenceRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
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
        !force &&
        previous.phase === next.phase &&
        previous.message === next.message &&
        now - lastStatusUpdateRef.current < 700
      ) {
        return;
      }
      statusRef.current = next;
      lastStatusUpdateRef.current = now;
      onStatus(next);
    },
    [onStatus],
  );

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(frameRef.current);
    stopStream();
    poseRef.current = null;
    qaFrameRef.current = null;
    qaDetectionCompleteRef.current = false;
    boundaryRef.current = null;
    smootherRef.current.reset();
    publishStatus({ phase: "idle", message: "试戴已暂停" }, true);
  }, [publishStatus, stopStream]);

  const resizeRenderer = useCallback(() => {
    const stage = stageRef.current;
    const renderer = rendererRef.current;
    if (!stage || !renderer) return;
    renderer.resize(stage.clientWidth, stage.clientHeight);
  }, []);

  const requestCamera = useCallback(async () => {
    if (QA_IMAGE_MODE) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头访问");
    }
    if (!window.isSecureContext && location.hostname !== "localhost") {
      throw new Error("摄像头需要通过 HTTPS 打开");
    }

    stopStream();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingRef.current },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play();
  }, [stopStream]);

  const animate = useCallback(() => {
    if (!activeRef.current || !rendererRef.current) return;
    const now = performance.now();
    const stage = stageRef.current;
    const video = videoRef.current;
    const image = imageRef.current;
    let frame = null;

    if (QA_IMAGE_MODE && image && trackerRef.current) {
      if (!qaDetectionCompleteRef.current && image.complete && image.naturalWidth > 0) {
        qaFrameRef.current = trackerRef.current.detectImage(image, now);
        qaDetectionCompleteRef.current = true;
      }
      frame = qaFrameRef.current;
    } else if (
      video &&
      trackerRef.current &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTimeRef.current &&
      now - lastInferenceRef.current >= 33
    ) {
      lastInferenceRef.current = now;
      lastVideoTimeRef.current = video.currentTime;
      frame = trackerRef.current.detect(video, now);
    }

    if (stage && frame) {
      const sourceWidth = QA_IMAGE_MODE
        ? image?.naturalWidth || stage.clientWidth
        : video?.videoWidth || stage.clientWidth;
      const sourceHeight = QA_IMAGE_MODE
        ? image?.naturalHeight || stage.clientHeight
        : video?.videoHeight || stage.clientHeight;
      const mapping: ViewportMapping = {
        sourceWidth,
        sourceHeight,
        width: stage.clientWidth,
        height: stage.clientHeight,
        mirrored: !QA_IMAGE_MODE && facingRef.current === "user",
      };
      const currentProduct = productRef.current;
      let pose = currentProduct.anchor === "finger"
        ? calculateFingerPose(
            frame.landmarks,
            frame.worldLandmarks,
            mapping,
            frame.handedness,
            currentProduct.finger ?? "ring",
            frame.score,
          )
        : calculateWristPose(
            frame.landmarks,
            frame.worldLandmarks,
            mapping,
            frame.handedness,
            frame.score,
          );
      const mediaSource = QA_IMAGE_MODE ? image : video;
      if (
        pose
        && currentProduct.anchor === "wrist"
        && mediaSource
        && now - lastBoundaryInferenceRef.current >= 80
      ) {
        lastBoundaryInferenceRef.current = now;
        const guide = calculateForearmGuide(frame.landmarks, mapping);
        if (guide) {
          const boundary = boundaryEstimatorRef.current.estimate(
            mediaSource,
            stage.clientWidth,
            stage.clientHeight,
            mapping.mirrored,
            guide,
            pose.scale,
          );
          if (boundary && boundary.confidence >= 0.34) {
            boundaryRef.current = { value: boundary, timestamp: now };
          }
        }
      }
      if (pose && boundaryRef.current && now - boundaryRef.current.timestamp < 260) {
        pose = applyArmBoundary(
          pose,
          boundaryRef.current.value,
          currentProduct.calibration.sizeMultiplier,
          currentProduct.calibration.modelPlaneSize,
        );
      }
      if (pose) {
        poseRef.current = smootherRef.current.update(pose, now);
        lastSeenRef.current = now;
      }
    }

    const timeSinceSeen = now - lastSeenRef.current;
    const holdOpacity = timeSinceSeen < 180 ? 1 : Math.max(0, 1 - (timeSinceSeen - 180) / 260);
    rendererRef.current.render(
      poseRef.current,
      faceModeRef.current,
      calibrationRef.current,
      holdOpacity,
      occlusionRef.current,
    );

    const counter = frameCounterRef.current;
    counter.count += 1;
    if (now - counter.since >= 1000) {
      counter.fps = Math.round((counter.count * 1000) / Math.max(1, now - counter.since));
      counter.count = 0;
      counter.since = now;
    }

    if (timeSinceSeen < 180) {
      publishStatus({
        phase: "tracking",
        message: "已贴合手腕",
        fps: counter.fps,
        facing: poseRef.current?.frontFacing ? "front" : "back",
      });
    } else if (poseRef.current && timeSinceSeen < 700) {
      publishStatus({ phase: "lost", message: "请保持手腕在画面内", fps: counter.fps });
    } else {
      publishStatus({ phase: "searching", message: "将手腕放入取景框", fps: counter.fps });
    }

    frameRef.current = requestAnimationFrame(animate);
  }, [publishStatus]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    publishStatus({ phase: "loading", message: "正在准备 AR" }, true);

    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("AR 画布初始化失败");
      const rendererPromise = rendererRef.current
        ? Promise.resolve(rendererRef.current)
        : import("../lib/arRenderer").then(({ JewelryRenderer }) => {
            const renderer = new JewelryRenderer(canvas);
            rendererRef.current = renderer;
            return renderer;
          });
      const trackerPromise = trackerRef.current
        ? Promise.resolve(trackerRef.current)
        : import("../lib/handTracker").then(({ BrowserHandTracker }) =>
            BrowserHandTracker.create(QA_IMAGE_MODE ? "IMAGE" : "VIDEO").then((tracker) => {
              trackerRef.current = tracker;
              return tracker;
            }),
          );
      const sourcePromise = QA_IMAGE_MODE
        ? imageRef.current?.decode()
        : requestCamera();

      const [renderer] = await Promise.all([rendererPromise, trackerPromise, sourcePromise]);
      resizeRenderer();
      await renderer.setProduct(productRef.current);
      activeRef.current = true;
      const now = performance.now();
      lastSeenRef.current = 0;
      lastBoundaryInferenceRef.current = 0;
      boundaryRef.current = null;
      qaFrameRef.current = null;
      qaDetectionCompleteRef.current = false;
      frameCounterRef.current = { count: 0, since: now, fps: 0 };
      publishStatus({ phase: "searching", message: "将手腕放入取景框" }, true);
      frameRef.current = requestAnimationFrame(animate);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AR 初始化失败";
      publishStatus({ phase: "error", message }, true);
      stopStream();
      throw error;
    }
  }, [animate, publishStatus, requestCamera, resizeRenderer, stopStream]);

  const switchCamera = useCallback(async () => {
    if (QA_IMAGE_MODE) return;
    facingRef.current = facingRef.current === "environment" ? "user" : "environment";
    videoRef.current?.classList.toggle("camera-feed--mirrored", facingRef.current === "user");
    if (!activeRef.current) return;
    publishStatus({ phase: "loading", message: "正在切换摄像头" }, true);
    await requestCamera();
    smootherRef.current.reset();
    poseRef.current = null;
    lastSeenRef.current = 0;
  }, [publishStatus, requestCamera]);

  const capture = useCallback(async () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    const image = imageRef.current;
    const overlay = canvasRef.current;
    if (!stage || !overlay) return null;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const width = Math.round(stage.clientWidth * pixelRatio);
    const height = Math.round(stage.clientHeight * pixelRatio);
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#767a75";
    context.fillRect(0, 0, width, height);
    if (QA_IMAGE_MODE && image?.naturalWidth && image.naturalHeight) {
      drawCover(
        context,
        image,
        image.naturalWidth,
        image.naturalHeight,
        width,
        height,
        false,
      );
    } else if (video?.videoWidth && video.videoHeight) {
      drawCover(
        context,
        video,
        video.videoWidth,
        video.videoHeight,
        width,
        height,
        facingRef.current === "user",
      );
    }
    context.drawImage(overlay, 0, 0, width, height);

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
    if (!rendererRef.current || !activeRef.current) return;
    rendererRef.current.setProduct(product).catch((error) => {
      console.error(error);
      publishStatus({ phase: "error", message: "首饰模型加载失败" }, true);
    });
  }, [product, publishStatus]);

  useEffect(
    () => () => {
      activeRef.current = false;
      cancelAnimationFrame(frameRef.current);
      stopStream();
      trackerRef.current?.close();
      rendererRef.current?.dispose();
    },
    [stopStream],
  );

  return (
    <div
      ref={stageRef}
      className="ar-stage"
      data-qa-image={qaKey ?? undefined}
    >
      {QA_IMAGE_URL ? (
        <img ref={imageRef} className="camera-feed" src={QA_IMAGE_URL} alt="手部追踪测试画面" />
      ) : (
        <video
          ref={videoRef}
          className={facingRef.current === "user" ? "camera-feed camera-feed--mirrored" : "camera-feed"}
          autoPlay
          muted
          playsInline
        />
      )}
      <canvas ref={canvasRef} className="jewelry-canvas" aria-label="AR 首饰渲染画布" />
    </div>
  );
});
