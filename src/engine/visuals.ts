import {
  AbstractMesh,
  Color3,
  LoadAssetContainerAsync,
  Material,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AssetContainer,
  type Mesh,
  type Scene,
} from './babylon';
import type { RunCostume, WorldMode } from '../player/protocol';
import { buildRecipeTemplate, recipeBounds } from './models';

/** 3D cutouts: 100 image pixels = 1 meter. */
export const PIXELS_PER_METER = 100;

export interface ImageCostume {
  kind: 'image';
  name: string;
  texture: Texture;
  material: StandardMaterial;
  /** Size in world units. */
  width: number;
  height: number;
  /** Where the plane's center sits relative to the sprite's origin. */
  offsetX: number;
  offsetY: number;
}

export interface ModelCostume {
  kind: 'model';
  name: string;
  /** Returns a fresh copy of the model to parent under a sprite. */
  instantiate(parent: TransformNode): TransformNode;
  width: number;
  height: number;
}

export type CostumeResource = ImageCostume | ModelCostume;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

/** Rasterizes an image (SVGs at extra resolution so they stay sharp) into a canvas-backed data URL. */
async function rasterize(c: RunCostume): Promise<{ url: string; pixelRatio: number }> {
  if (!c.isVector) return { url: c.url, pixelRatio: 1 };
  const img = await loadImage(c.url);
  const w = img.naturalWidth || c.width || 100;
  const h = img.naturalHeight || c.height || 100;
  const scale = Math.min(4, Math.max(1, 1024 / Math.max(w, h)), 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { url: c.url, pixelRatio: 1 };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL('image/png'), pixelRatio: scale };
}

function textureFromUrl(url: string, scene: Scene): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const tex: Texture = new Texture(
      url,
      scene,
      false,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
      () => resolve(tex),
      (message) => reject(new Error(message ?? 'Texture failed to load')),
    );
  });
}

async function loadImageCostume(c: RunCostume, mode: WorldMode, scene: Scene): Promise<ImageCostume> {
  const { url } = await rasterize(c);
  const texture = await textureFromUrl(url, scene);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const material = new StandardMaterial(`costume:${c.name}`, scene);
  material.diffuseTexture = texture;
  // Unlit: with lighting disabled the texture is multiplied by the emissive color.
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.useAlphaFromDiffuseTexture = true;
  if (mode === '2d') {
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.disableDepthWrite = true;
  } else {
    // Cutouts use alpha testing so they sort correctly with 3D geometry and cast proper shadows.
    material.transparencyMode = Material.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.5;
  }
  const res = c.resolution || 1;
  const w = (c.width || texture.getSize().width) / res;
  const h = (c.height || texture.getSize().height) / res;
  const cx = (c.centerX ?? c.width / 2) / res;
  const cy = (c.centerY ?? c.height / 2) / res;
  if (mode === '2d') {
    return { kind: 'image', name: c.name, texture, material, width: w, height: h, offsetX: w / 2 - cx, offsetY: cy - h / 2 };
  }
  // 3D cutouts stand on their bottom edge.
  const mw = w / PIXELS_PER_METER;
  const mh = h / PIXELS_PER_METER;
  return { kind: 'image', name: c.name, texture, material, width: mw, height: mh, offsetX: 0, offsetY: mh / 2 };
}

async function loadModelCostume(c: RunCostume, mode: WorldMode, scene: Scene): Promise<ModelCostume> {
  const scale = mode === '2d' ? PIXELS_PER_METER : 1;
  if (c.recipe) {
    const template = buildRecipeTemplate(c.recipe, c.name, scene);
    const { min, max } = recipeBounds(c.recipe);
    return {
      kind: 'model',
      name: c.name,
      width: (max[0] - min[0]) * scale,
      height: (max[1] - min[1]) * scale,
      instantiate(parent) {
        const copy = template.instantiateHierarchy(parent, { doNotInstantiate: true }) as TransformNode;
        copy.setEnabled(true);
        copy.scaling.setAll(scale);
        return copy;
      },
    };
  }
  const container: AssetContainer = await LoadAssetContainerAsync(c.url, scene, { pluginExtension: '.glb' });
  const probe = container.instantiateModelsToScene((n: string) => n, false, { doNotInstantiate: true });
  const probeRoot = probe.rootNodes[0] as TransformNode | undefined;
  let width = 1;
  let height = 1;
  if (probeRoot) {
    const { min, max } = probeRoot.getHierarchyBoundingVectors(true);
    width = max.x - min.x;
    height = max.y - min.y;
    probe.dispose();
  }
  return {
    kind: 'model',
    name: c.name,
    width: width * scale,
    height: height * scale,
    instantiate(parent) {
      const entries = container.instantiateModelsToScene((n: string) => n, false, { doNotInstantiate: true });
      const holder = new TransformNode(`glb:${c.name}`, scene);
      for (const node of entries.rootNodes) node.parent = holder;
      for (const group of entries.animationGroups) group.play(true);
      holder.parent = parent;
      holder.scaling.setAll(scale);
      return holder;
    },
  };
}

/** Loads every costume of one sprite (or backdrops of the stage). Broken costumes are skipped with a warning. */
export async function loadCostumes(costumes: RunCostume[], mode: WorldMode, scene: Scene): Promise<CostumeResource[]> {
  const loaded = await Promise.all(
    costumes.map(async (c) => {
      try {
        return c.kind === 'model' ? await loadModelCostume(c, mode, scene) : await loadImageCostume(c, mode, scene);
      } catch (err) {
        console.warn(`Could not load costume "${c.name}": ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return loaded.filter((c): c is CostumeResource => c !== null);
}

/** A sprite's on-screen look: one plane for image costumes, plus lazily created model copies. */
export class SpriteVisual {
  readonly plane: Mesh;
  private models = new Map<string, TransformNode>();
  private current: CostumeResource | null = null;
  private ownMaterial: StandardMaterial | null = null;
  private tintColor: Color3 | null = null;

  constructor(
    private readonly node: TransformNode,
    private readonly mode: WorldMode,
    private readonly scene: Scene,
  ) {
    this.plane = MeshBuilder.CreatePlane(`${node.name}:plane`, { size: 1 }, scene);
    this.plane.parent = node;
    this.plane.isPickable = true;
    if (mode === '3d') this.plane.billboardMode = AbstractMesh.BILLBOARDMODE_Y;
  }

  get costume(): CostumeResource | null {
    return this.current;
  }

  /** Meshes that make up the current look (for picking, bounds, shadows). */
  meshes(): AbstractMesh[] {
    if (!this.current) return [];
    if (this.current.kind === 'image') return [this.plane];
    const model = this.models.get(this.current.name);
    return model ? model.getChildMeshes(false) : [];
  }

  show(costume: CostumeResource): void {
    this.current = costume;
    if (costume.kind === 'image') {
      this.plane.setEnabled(true);
      this.plane.scaling.set(costume.width, costume.height, 1);
      this.plane.position.set(costume.offsetX, costume.offsetY, 0);
      this.applyMaterial(costume.material);
      this.models.forEach((m) => m.setEnabled(false));
    } else {
      this.plane.setEnabled(false);
      this.models.forEach((m, name) => m.setEnabled(name === costume.name));
      if (!this.models.has(costume.name)) {
        const model = costume.instantiate(this.node);
        this.models.set(costume.name, model);
        for (const mesh of model.getChildMeshes(false)) mesh.metadata = { ...(mesh.metadata ?? {}), amble: this.node.metadata?.amble };
      }
    }
  }

  private applyMaterial(base: StandardMaterial): void {
    if (this.tintColor) {
      if (!this.ownMaterial || this.ownMaterial.diffuseTexture !== base.diffuseTexture) {
        this.ownMaterial?.dispose();
        this.ownMaterial = base.clone(`${base.name}:tinted`) as StandardMaterial;
      }
      this.ownMaterial.emissiveColor = this.tintColor;
      this.plane.material = this.ownMaterial;
    } else {
      this.plane.material = base;
    }
  }

  set tint(color: Color3 | null) {
    this.tintColor = color;
    if (this.current?.kind === 'image') this.applyMaterial(this.current.material);
  }

  set opacity(value: number) {
    const v = Math.max(0, Math.min(1, value));
    this.plane.visibility = v;
    this.models.forEach((m) => m.getChildMeshes(false).forEach((mesh) => (mesh.visibility = v)));
  }

  set layer(value: number) {
    this.plane.alphaIndex = value;
    if (this.mode === '2d') this.plane.position.z = 0;
  }

  /** Size of the current look in world units (before sprite scaling). */
  get size(): { width: number; height: number } {
    return this.current ? { width: this.current.width, height: this.current.height } : { width: 0, height: 0 };
  }

  dispose(): void {
    this.ownMaterial?.dispose();
    this.plane.dispose();
    this.models.forEach((m) => m.dispose());
  }

  /** World-space top point, for speech bubbles. */
  topPoint(): Vector3 {
    const meshes = this.meshes();
    if (!meshes.length) return this.node.getAbsolutePosition().clone();
    let maxY = -Infinity;
    let sumX = 0;
    let sumZ = 0;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      maxY = Math.max(maxY, bb.maximumWorld.y);
      sumX += (bb.minimumWorld.x + bb.maximumWorld.x) / 2;
      sumZ += (bb.minimumWorld.z + bb.maximumWorld.z) / 2;
    }
    void this.scene;
    return new Vector3(sumX / meshes.length, maxY, sumZ / meshes.length);
  }
}
