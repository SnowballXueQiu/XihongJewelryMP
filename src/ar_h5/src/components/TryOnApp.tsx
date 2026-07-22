'use client'
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CameraIcon,
  ChevronUp,
  RefreshCw,
  SlidersHorizontal,
  SwitchCamera,
  TriangleAlert,
} from "lucide-react";
import { ARStage, type ARStageHandle } from "./ARStage";
import { CalibrationPanel } from "./CalibrationPanel";
import { CapturePreview } from "./CapturePreview";
import { FaceModeControl } from "./FaceModeControl";
import { ProductRail } from "./ProductRail";
import { StatusIndicator } from "./StatusIndicator";
import { DEFAULT_USER_CALIBRATION, PRODUCTS } from "../data/products";
import { nextManualFaceMode } from "../lib/modelFace";
import type {
  FaceMode,
  JewelryProduct,
  TrackingStatus,
  UserCalibration,
} from "../types/ar";

type CaptureState = { url: string; blob: Blob } | null;

export function TryOnApp() {
  const stageRef = useRef<ARStageHandle>(null);
  const startAttemptRef = useRef(0);
  const [product, setProduct] = useState<JewelryProduct>(PRODUCTS[0]);
  const [faceMode, setFaceMode] = useState<FaceMode>("auto");
  const [calibration, setCalibration] = useState<UserCalibration>(DEFAULT_USER_CALIBRATION);
  const [occlusion, setOcclusion] = useState(true);
  const [status, setStatus] = useState<TrackingStatus>({ phase: "idle", message: "准备试戴" });
  const [started, setStarted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capture, setCapture] = useState<CaptureState>(null);

  const handleStatus = useCallback((next: TrackingStatus) => {
    setStatus(next);
    if (next.phase === "idle" || next.phase === "error") {
      startAttemptRef.current += 1;
      setStarted(false);
    }
  }, []);

  const handleStart = async () => {
    const attempt = ++startAttemptRef.current;
    try {
      await stageRef.current?.start();
      if (attempt === startAttemptRef.current) setStarted(true);
    } catch {
      if (attempt === startAttemptRef.current) setStarted(false);
    }
  };

  const handleSwitchCamera = async () => {
    try {
      await stageRef.current?.switchCamera();
    } catch {
      // ARStage publishes the actionable error and returns to the start gate.
    }
  };

  const handleCapture = async () => {
    const blob = await stageRef.current?.capture();
    if (!blob) return;
    setCapture({ blob, url: URL.createObjectURL(blob) });
  };

  const closeCapture = () => {
    setCapture((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const handleProductSelect = (next: JewelryProduct) => {
    setProduct(next);
    setCalibration(DEFAULT_USER_CALIBRATION);
  };

  useEffect(() => () => {
    if (capture) URL.revokeObjectURL(capture.url);
  }, [capture]);

  return (
    <main className="tryon-app">
      <ARStage
        ref={stageRef}
        product={product}
        faceMode={faceMode}
        calibration={calibration}
        occlusion={occlusion}
        onStatus={handleStatus}
      />

      <div className="camera-shade camera-shade--top" aria-hidden="true" />
      {started ? <div className="camera-shade camera-shade--bottom" aria-hidden="true" /> : null}

      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          aria-label="返回"
          title="返回"
          onClick={() => window.history.back()}
        >
          <ArrowLeft size={22} />
        </button>
        <h1>AR 试戴</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="切换摄像头"
          title="切换摄像头"
          disabled={!started || status.phase === "loading"}
          onClick={() => void handleSwitchCamera()}
        >
          {status.phase === "loading"
            ? <RefreshCw className="is-spinning" size={21} />
            : <SwitchCamera size={21} />}
        </button>
      </header>

      {started ? <StatusIndicator status={status} faceMode={faceMode} /> : null}

      {!started ? (
        <section className="permission-gate" aria-label="开始 AR 试戴">
          <div className="permission-gate__mark" aria-hidden="true">
            <CameraIcon size={30} strokeWidth={1.7} />
          </div>
          <h2>戴上看看</h2>
          <p>摄像头画面只在本机处理</p>
          {status.phase === "error" ? (
            <div className="permission-error" role="alert">
              <TriangleAlert size={16} />
              <span>{status.message}</span>
            </div>
          ) : null}
          <button type="button" className="start-button" onClick={() => void handleStart()} disabled={status.phase === "loading"}>
            {status.phase === "loading" ? <RefreshCw className="is-spinning" size={19} /> : <Camera size={19} />}
            {status.phase === "loading" ? "正在准备" : "打开摄像头"}
          </button>
        </section>
      ) : null}

      {started ? (
        <section className="tryon-controls" aria-label="试戴控制">
          <div className="tryon-controls__meta">
            <div>
              <strong>{product.name}</strong>
              <span>{product.subtitle}</span>
            </div>
            <FaceModeControl value={faceMode} onChange={setFaceMode} />
          </div>

          <ProductRail products={PRODUCTS} selectedId={product.id} onSelect={handleProductSelect} />

          <div className="capture-row">
            <button
              type="button"
              className="icon-button icon-button--soft"
              aria-label="模型标定"
              title="模型标定"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              {settingsOpen ? <ChevronUp size={21} /> : <SlidersHorizontal size={21} />}
            </button>
            <button type="button" className="shutter" aria-label="拍摄试戴照片" title="拍摄" onClick={() => void handleCapture()}>
              <span />
            </button>
            <button
              type="button"
              className="icon-button icon-button--soft"
              aria-label="切换首饰正反面"
              title="切换正反面"
              onClick={() => setFaceMode(nextManualFaceMode)}
            >
              <RefreshCw size={21} />
            </button>
          </div>
        </section>
      ) : null}

      {started && settingsOpen ? (
        <CalibrationPanel
          value={calibration}
          occlusion={occlusion}
          onChange={setCalibration}
          onOcclusionChange={setOcclusion}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {capture ? <CapturePreview {...capture} onClose={closeCapture} /> : null}
    </main>
  );
}
