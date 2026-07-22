import {
  Box3,
  BufferGeometry,
  Camera,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type {
  FaceMode,
  JewelryProduct,
  Pose,
  UserCalibration,
} from "../types/ar";
import { shouldFlipModel } from "./modelFace";
import { pixelPoseToCamera } from "./projection";

export type JewelrySceneContext = {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: Camera;
  renderer: WebGLRenderer;
};

type LoadedModel = {
  group: Group;
  geometries: BufferGeometry[];
  materials: Material[];
};

function disposeLoadedModel(model: LoadedModel | null) {
  if (!model) return;
  model.geometries.forEach((geometry) => geometry.dispose());
  model.materials.forEach((material) => material.dispose());
}

export class JewelryRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly ownsRenderer: boolean;
  private readonly trackingRoot = new Group();
  private readonly modelPivot = new Group();
  private readonly lighting = new Group();
  private readonly occluder: Mesh;
  private readonly userRotation = new Quaternion();
  private readonly screenAxis = new Vector3(0, 0, 1);
  private loaded: LoadedModel | null = null;
  private product: JewelryProduct | null = null;
  private environmentTexture: Texture | null = null;
  private width = 1;
  private height = 1;
  private generation = 0;

  constructor(source: HTMLCanvasElement | JewelrySceneContext) {
    if (source instanceof HTMLCanvasElement) {
      this.canvas = source;
      this.scene = new Scene();
      const camera = new PerspectiveCamera(52, 1, 0.01, 10);
      camera.position.set(0, 0, 0);
      this.camera = camera;
      this.scene.add(camera);
      this.renderer = new WebGLRenderer({
        canvas: source,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.ownsRenderer = true;
    } else {
      this.canvas = source.canvas;
      this.scene = source.scene;
      this.camera = source.camera;
      this.renderer = source.renderer;
      this.ownsRenderer = false;
    }

    this.canvas.dataset.renderState = "pending";
    this.lighting.add(new HemisphereLight(0xfff8ec, 0x2b3841, 2.4));
    const key = new DirectionalLight(0xffffff, 4.2);
    key.position.set(-0.45, 0.62, 1.1);
    this.lighting.add(key);
    const fill = new DirectionalLight(0xa8c4dc, 1.7);
    fill.position.set(0.65, -0.2, 0.75);
    this.lighting.add(fill);
    this.camera.add(this.lighting);

    if (!this.scene.environment) {
      const pmrem = new PMREMGenerator(this.renderer);
      this.environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.environmentTexture;
      pmrem.dispose();
    }

    const depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
    });
    this.occluder = new Mesh(new SphereGeometry(0.5, 40, 24), depthMaterial);
    this.occluder.renderOrder = 0;
    this.trackingRoot.add(this.occluder, this.modelPivot);
    this.camera.add(this.trackingRoot);
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    if (this.ownsRenderer && this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
  }

  async setProduct(product: JewelryProduct) {
    const currentGeneration = ++this.generation;
    const gltf = await new GLTFLoader().loadAsync(product.modelUrl);
    if (currentGeneration !== this.generation) return;

    const model = gltf.scene.clone(true);
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const planeDiameter = Math.max(size.x, size.y) || 1;
    model.position.copy(center).multiplyScalar(-1);
    const normalizedRoot = new Group();
    normalizedRoot.scale.setScalar(1 / planeDiameter);
    normalizedRoot.add(model);

    const materials: Material[] = [];
    const geometries: BufferGeometry[] = [];
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      child.renderOrder = 1;
      geometries.push(child.geometry);
      const sourceMaterials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      const cloned = sourceMaterials.map((material) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.depthWrite = true;
        materials.push(copy);
        return copy;
      });
      child.material = Array.isArray(child.material) ? cloned : cloned[0];
    });

    this.modelPivot.clear();
    this.modelPivot.add(normalizedRoot);
    disposeLoadedModel(this.loaded);
    this.loaded = { group: normalizedRoot, geometries, materials };
    this.product = product;
    this.occluder.scale.set(
      product.anchor === "finger" ? 0.58 : 0.82,
      product.anchor === "finger" ? 0.58 : 0.66 * product.calibration.modelPlaneSize[1],
      product.anchor === "finger" ? 0.96 : 1.18,
    );
    this.canvas.dataset.renderState = "pending";
    this.canvas.dataset.modelPhysicalWidth = product.calibration.modelOuterWidthMeters.toFixed(4);
  }

  render(
    pose: Pose | null,
    faceMode: FaceMode,
    userCalibration: UserCalibration,
    opacity = 1,
    occlusion = true,
  ) {
    if (!this.loaded || !this.product || !pose) {
      this.trackingRoot.visible = false;
      if (this.ownsRenderer) this.renderer.render(this.scene, this.camera);
      return;
    }

    const { calibration } = this.product;
    const pixelX = pose.x + userCalibration.offsetX;
    const pixelY = pose.y + userCalibration.offsetY;
    const placement = pixelPoseToCamera(
      pixelX,
      pixelY,
      this.width,
      this.height,
      this.camera.projectionMatrix.elements,
    );
    const scale = pose.scale
      * placement.worldPerPixel
      * calibration.sizeMultiplier
      * userCalibration.scale;

    this.trackingRoot.visible = opacity > 0.01;
    this.trackingRoot.position.set(...placement.position);
    this.trackingRoot.scale.setScalar(scale);
    this.trackingRoot.quaternion.fromArray(pose.orientation);
    if (userCalibration.rotation !== 0) {
      this.userRotation.setFromAxisAngle(this.screenAxis, -userCalibration.rotation);
      this.trackingRoot.quaternion.premultiply(this.userRotation);
    }

    const modelFlipped = shouldFlipModel(faceMode);
    const flip = modelFlipped ? calibration.frontFlip : [0, 0, 0];
    this.modelPivot.position.set(...calibration.positionOffset);
    this.modelPivot.rotation.set(
      calibration.baseRotation[0] + flip[0],
      calibration.baseRotation[1] + flip[1],
      calibration.baseRotation[2] + flip[2],
    );
    this.occluder.visible = occlusion;
    this.loaded.materials.forEach((material) => {
      material.opacity = opacity;
    });

    this.canvas.dataset.poseScale = (pose.scale * calibration.sizeMultiplier).toFixed(1);
    this.canvas.dataset.scaleCorrection = pose.scaleCorrection.toFixed(2);
    this.canvas.dataset.scaleSource = pose.armWidth === undefined ? "landmarks" : "pixels";
    this.canvas.dataset.handFacing = pose.frontFacing ? "palm" : "back";
    this.canvas.dataset.modelFlipped = String(modelFlipped);
    this.canvas.dataset.renderState = this.trackingRoot.visible ? "visible" : "hidden";
    if (pose.armWidth !== undefined) {
      this.canvas.dataset.armWidth = pose.armWidth.toFixed(1);
      this.canvas.dataset.boundaryConfidence = (pose.boundaryConfidence ?? 0).toFixed(2);
      this.canvas.dataset.boundarySource = pose.boundarySource ?? "unknown";
    } else {
      delete this.canvas.dataset.armWidth;
      delete this.canvas.dataset.boundaryConfidence;
      delete this.canvas.dataset.boundarySource;
    }

    if (this.ownsRenderer) this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.generation += 1;
    disposeLoadedModel(this.loaded);
    this.loaded = null;
    this.trackingRoot.removeFromParent();
    this.lighting.removeFromParent();
    this.occluder.geometry.dispose();
    (this.occluder.material as Material).dispose();
    if (this.environmentTexture && this.scene.environment === this.environmentTexture) {
      this.scene.environment = null;
      this.environmentTexture.dispose();
    }
    if (this.ownsRenderer) this.renderer.dispose();
  }
}
