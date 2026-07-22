import type * as Three from "three";

export type XR8CameraDirection = "user" | "environment";

export type XR8CameraPixelResult = {
  rows: number;
  cols: number;
  rowBytes: number;
  pixels: Uint8Array;
};

export type XR8PipelineModule = {
  name: string;
  onAttach?: (args: Record<string, unknown>) => void;
  onStart?: (args: Record<string, unknown>) => void | Promise<void>;
  onProcessCpu?: (args: {
    processGpuResult?: { camerapixelarray?: XR8CameraPixelResult };
  }) => void;
  onUpdate?: (args: Record<string, unknown>) => void;
  onCanvasSizeChange?: (args: { canvasWidth: number; canvasHeight: number }) => void;
  onCameraStatusChange?: (args: { status: string }) => void;
  onException?: (error: unknown) => void;
  onDetach?: () => void;
};

export type XR8Api = {
  CameraPixelArray: {
    pipelineModule: (options: {
      luminance: boolean;
      maxDimension: number;
    }) => XR8PipelineModule;
  };
  GlTextureRenderer: { pipelineModule: () => XR8PipelineModule };
  Threejs: {
    configure: (options: { renderCameraTexture: boolean }) => void;
    pipelineModule: () => XR8PipelineModule;
    xrScene: () => {
      scene: Three.Scene;
      camera: Three.Camera;
      renderer: Three.WebGLRenderer;
    };
  };
  XrConfig: {
    camera: () => { FRONT: unknown; BACK: unknown };
    device: () => { ANY: unknown };
  };
  XrController: null | {
    configure: (options: {
      disableWorldTracking?: boolean;
      mirroredDisplay?: boolean;
    }) => void;
    pipelineModule: () => XR8PipelineModule;
    updateCameraProjectionMatrix: (options: {
      origin: Three.Vector3;
      facing: Three.Quaternion;
    }) => void;
  };
  addCameraPipelineModules: (modules: XR8PipelineModule[]) => void;
  clearCameraPipelineModules: () => void;
  loadChunk: (name: "slam") => Promise<void>;
  run: (options: {
    canvas: HTMLCanvasElement;
    allowFront: boolean;
    allowedDevices: unknown;
    cameraConfig: { direction: unknown };
    glContextConfig: WebGLContextAttributes;
  }) => void;
  stop: () => void;
  version: () => string;
};

declare global {
  interface Window {
    XR8?: XR8Api;
    THREE?: typeof Three;
  }
}
