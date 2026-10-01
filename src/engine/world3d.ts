import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  MeshBuilder,
  PhysicsBody,
  PhysicsMotionType,
  PhysicsShapeBox,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  type AbstractMesh,
  type Mesh,
} from './babylon';
import { parseColor } from './effects';

export interface GroundOptions {
  /** Width/depth in meters (default 200). */
  size?: number;
  color?: string;
  /** Draw a subtle grid (default true). */
  grid?: boolean;
}

export interface SunOptions {
  /** Direction the light travels, e.g. [-0.5, -1, 0.3]. */
  direction?: [number, number, number];
  intensity?: number;
  color?: string;
}

/** Default 3D surroundings: sky, sun with shadows, ambient light and a ground plane. All adjustable. */
export class World3D {
  readonly sun: DirectionalLight;
  readonly ambientLight: HemisphericLight;
  readonly shadowGenerator: ShadowGenerator;
  groundMesh: Mesh | null = null;
  private groundBody: PhysicsBody | null = null;
  private skyMesh: Mesh;
  private shadowsOn = true;

  constructor(private readonly scene: Scene) {
    this.ambientLight = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    this.ambientLight.intensity = 0.65;
    this.ambientLight.groundColor = new Color3(0.35, 0.33, 0.3);
    this.sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene);
    this.sun.position = new Vector3(20, 40, -20);
    this.sun.intensity = 0.9;
    this.shadowGenerator = new ShadowGenerator(2048, this.sun);
    this.shadowGenerator.usePercentageCloserFiltering = true;
    this.shadowGenerator.bias = 0.0015;
    this.shadowGenerator.normalBias = 0.02;
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 150;
    this.skyMesh = MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 16, sideOrientation: 1 }, scene);
    this.skyMesh.isPickable = false;
    this.skyMesh.infiniteDistance = true;
    this.skyMesh.applyFog = false;
    const skyMat = new StandardMaterial('sky', scene);
    skyMat.disableLighting = true;
    skyMat.backFaceCulling = false;
    skyMat.emissiveColor = Color3.White();
    this.skyMesh.material = skyMat;
    this.sky(['#6fb7ff', '#dff1ff']);
    this.ground({});
  }

  /** Sky color: one color or [top, horizon]. */
  sky(colors: string | [string, string]): void {
    const [top, bottom] = typeof colors === 'string' ? [colors, colors] : colors;
    const t = parseColor(top);
    const b = parseColor(bottom);
    this.scene.clearColor = new Color4(b.r, b.g, b.b, 1);
    const positions = this.skyMesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colorsData: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const k = Math.max(0, Math.min(1, positions[i + 1] / 900 + 0.15));
      colorsData.push(b.r + (t.r - b.r) * k, b.g + (t.g - b.g) * k, b.b + (t.b - b.b) * k, 1);
    }
    this.skyMesh.setVerticesData(VertexBuffer.ColorKind, colorsData);
  }

  /** Replace (or remove with `false`) the default ground. */
  ground(opts: GroundOptions | false): void {
    this.groundMesh?.dispose();
    this.groundBody?.dispose();
    this.groundMesh = null;
    this.groundBody = null;
    if (opts === false) return;
    const size = opts.size ?? 200;
    const ground = MeshBuilder.CreateGround('ground', { width: size, height: size }, this.scene);
    const mat = new StandardMaterial('ground', this.scene);
    const color = parseColor(opts.color ?? '#7cb86a');
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    if (opts.grid !== false) {
      const tex = new DynamicTexture('ground-grid', { width: 256, height: 256 }, this.scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      ctx.fillStyle = color.toHexString();
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 256, 256);
      tex.update();
      tex.wrapU = Texture.WRAP_ADDRESSMODE;
      tex.wrapV = Texture.WRAP_ADDRESSMODE;
      tex.uScale = size / 2;
      tex.vScale = size / 2;
      mat.diffuseTexture = tex;
    } else {
      mat.diffuseColor = color;
    }
    ground.material = mat;
    ground.receiveShadows = true;
    ground.isPickable = true;
    ground.metadata = { ground: true };
    this.groundMesh = ground;
    if (this.scene.getPhysicsEngine()) {
      const body = new PhysicsBody(ground, PhysicsMotionType.STATIC, false, this.scene);
      body.shape = new PhysicsShapeBox(new Vector3(0, -0.5, 0), Quaternion.Identity(), new Vector3(size, 1, size), this.scene);
      body.shape.material = { friction: 0.8, restitution: 0 };
      body.setCollisionCallbackEnabled(true);
      this.groundBody = body;
    }
  }

  fog(color: string | false, density = 0.01): void {
    if (color === false) {
      this.scene.fogMode = Scene.FOGMODE_NONE;
      return;
    }
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = parseColor(color);
    this.scene.fogDensity = density;
  }

  sunlight(opts: SunOptions): void {
    if (opts.direction) this.sun.direction = new Vector3(...opts.direction).normalize();
    if (opts.intensity !== undefined) this.sun.intensity = opts.intensity;
    if (opts.color) this.sun.diffuse = parseColor(opts.color);
  }

  ambient(intensity: number, color?: string): void {
    this.ambientLight.intensity = intensity;
    if (color) this.ambientLight.diffuse = parseColor(color);
  }

  shadows(on: boolean): void {
    this.shadowsOn = on;
    const map = this.shadowGenerator.getShadowMap();
    if (map) map.refreshRate = on ? 1 : 0;
    if (!on) map?.renderList?.splice(0);
  }

  /** Makes a mesh (and its children) cast shadows. */
  addShadowCaster(mesh: AbstractMesh): void {
    if (!this.shadowsOn) return;
    this.shadowGenerator.addShadowCaster(mesh, true);
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    this.shadowGenerator.removeShadowCaster(mesh, true);
  }
}
