import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { shouldFlipModel } from "./modelFace";
import type {
  FaceMode,
  JewelryProduct,
  Pose,
  UserCalibration,
} from "../types/ar";

type LoadedModel = {
  group: Group;
  materials: Material[];
};

export class JewelryRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2400);
  private readonly trackingRoot = new Group();
  private readonly modelPivot = new Group();
  private readonly occluder: Mesh;
  private readonly userRotation = new Quaternion();
  private readonly screenAxis = new Vector3(0, 0, 1);
  private loaded: LoadedModel | null = null;
  private product: JewelryProduct | null = null;
  private width = 1;
  private height = 1;
  private generation = 0;
  private frameVerified = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas.dataset.renderState = "pending";

    this.camera.position.z = 1000;
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new HemisphereLight(0xf6f2e8, 0x33404a, 2.1));
    const key = new DirectionalLight(0xffffff, 3.6);
    key.position.set(-240, 320, 620);
    this.scene.add(key);
    const fill = new DirectionalLight(0x9fb9d1, 1.5);
    fill.position.set(320, -120, 380);
    this.scene.add(fill);

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
    });
    this.occluder = new Mesh(new SphereGeometry(0.5, 36, 18), depthMaterial);
    this.occluder.scale.set(0.86, 0.68, 1.4);
    this.occluder.renderOrder = 0;
    this.trackingRoot.add(this.occluder);
    this.trackingRoot.add(this.modelPivot);
    this.scene.add(this.trackingRoot);
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
  }

  async setProduct(product: JewelryProduct) {
    const currentGeneration = ++this.generation;
    const gltf = await new GLTFLoader().loadAsync(product.modelUrl);
    if (currentGeneration !== this.generation) return;

    const model = gltf.scene.clone(true);
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const largestDimension = Math.max(size.x, size.y, size.z) || 1;
    model.position.copy(center).multiplyScalar(-1);
    const normalizedRoot = new Group();
    normalizedRoot.scale.setScalar(1 / largestDimension);
    normalizedRoot.add(model);

    const materials: Material[] = [];
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.castShadow = false;
      child.receiveShadow = false;
      child.renderOrder = 1;
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
    this.loaded?.materials.forEach((material) => material.dispose());
    this.loaded = { group: normalizedRoot, materials };
    this.product = product;
    this.frameVerified = false;
    this.canvas.dataset.renderState = "pending";
    delete this.canvas.dataset.visiblePixels;
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
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const { calibration } = this.product;
    const scale = pose.scale * calibration.sizeMultiplier * userCalibration.scale;

    this.trackingRoot.visible = opacity > 0.01;
    this.trackingRoot.position.set(
      pose.x - this.width / 2 + userCalibration.offsetX,
      this.height / 2 - pose.y - userCalibration.offsetY,
      0,
    );
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
    this.canvas.dataset.poseScale = scale.toFixed(1);
    this.canvas.dataset.scaleCorrection = pose.scaleCorrection.toFixed(2);
    this.canvas.dataset.scaleSource = pose.armWidth === undefined ? "landmarks" : "pixels";
    if (pose.armWidth !== undefined) {
      this.canvas.dataset.armWidth = pose.armWidth.toFixed(1);
      this.canvas.dataset.boundaryConfidence = (pose.boundaryConfidence ?? 0).toFixed(2);
      this.canvas.dataset.targetSpan = (pose.targetSpan ?? pose.armWidth).toFixed(1);
      this.canvas.dataset.planeProjection = (pose.planeProjection ?? 1).toFixed(2);
    } else {
      delete this.canvas.dataset.armWidth;
      delete this.canvas.dataset.boundaryConfidence;
      delete this.canvas.dataset.targetSpan;
      delete this.canvas.dataset.planeProjection;
    }
    this.canvas.dataset.handFacing = pose.frontFacing ? "palm" : "back";
    this.canvas.dataset.modelFlipped = String(modelFlipped);
    this.renderer.render(this.scene, this.camera);
    if (!this.frameVerified) this.verifyRenderedPixels(pose);
  }

  private verifyRenderedPixels(pose: Pose) {
    const gl = this.renderer.getContext();
    const pixelRatio = this.canvas.width / this.width;
    const sampleSize = Math.round(Math.max(48, Math.min(300, pose.scale * pixelRatio * 1.5)));
    const centerX = Math.round(pose.x * pixelRatio);
    const centerY = Math.round((this.height - pose.y) * pixelRatio);
    const x = Math.max(0, Math.min(this.canvas.width - sampleSize, centerX - sampleSize / 2));
    const y = Math.max(0, Math.min(this.canvas.height - sampleSize, centerY - sampleSize / 2));
    const pixels = new Uint8Array(sampleSize * sampleSize * 4);
    gl.readPixels(x, y, sampleSize, sampleSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let visiblePixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 8) visiblePixels += 1;
    }
    this.canvas.dataset.visiblePixels = String(visiblePixels);
    this.canvas.dataset.renderState = visiblePixels > 8 ? "visible" : "blank";
    this.frameVerified = visiblePixels > 8;
  }

  getCanvas() {
    return this.canvas;
  }

  dispose() {
    this.generation += 1;
    this.loaded?.materials.forEach((material) => material.dispose());
    this.occluder.geometry.dispose();
    (this.occluder.material as MeshBasicMaterial).dispose();
    this.renderer.dispose();
  }
}
