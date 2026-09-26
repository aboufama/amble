import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from './babylon';
import type { ModelPart, ModelRecipe } from '../player/protocol';

const DEG = Math.PI / 180;

function parseColor(hex: string): Color3 {
  try {
    const clean = /^#?[0-9a-f]{6}$/i.test(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : '#cccccc';
    return Color3.FromHexString(clean);
  } catch {
    return new Color3(0.8, 0.8, 0.8);
  }
}

function unitShape(part: ModelPart, name: string, scene: Scene): Mesh {
  switch (part.shape) {
    case 'sphere':
      return MeshBuilder.CreateSphere(name, { diameter: 1, segments: 16 }, scene);
    case 'cylinder':
      return MeshBuilder.CreateCylinder(name, { diameter: 1, height: 1, tessellation: 24 }, scene);
    case 'cone':
      return MeshBuilder.CreateCylinder(name, { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 24 }, scene);
    case 'torus':
      return MeshBuilder.CreateTorus(name, { diameter: 0.75, thickness: 0.25, tessellation: 32 }, scene);
    case 'capsule':
      return MeshBuilder.CreateCapsule(name, { height: 1, radius: 0.5, tessellation: 16 }, scene);
    case 'box':
    default:
      return MeshBuilder.CreateBox(name, { size: 1 }, scene);
  }
}

/**
 * Builds a model made of primitive parts (how the compiler describes AI-made 3D models).
 * Returns a disabled template; use `instantiateHierarchy` to place copies.
 */
export function buildRecipeTemplate(recipe: ModelRecipe, name: string, scene: Scene): TransformNode {
  const root = new TransformNode(`model:${name}`, scene);
  const materials = new Map<string, StandardMaterial>();
  recipe.parts.slice(0, 200).forEach((part, i) => {
    const mesh = unitShape(part, `${name}:${i}`, scene);
    const [sx, sy, sz] = part.size.map((v) => Math.max(0.001, Math.abs(Number(v) || 0.001)));
    // The torus's unit size is 1 x 0.25 x 1; stretch it so `size` is its bounding box.
    mesh.scaling = part.shape === 'torus' ? new Vector3(sx, sy / 0.25, sz) : new Vector3(sx, sy, sz);
    mesh.position = new Vector3(...(part.position.map((v) => Number(v) || 0) as [number, number, number]));
    mesh.rotation = new Vector3(...(part.rotation.map((v) => (Number(v) || 0) * DEG) as [number, number, number]));
    const opacity = Math.max(0, Math.min(1, part.opacity ?? 1));
    const key = `${part.color}|${part.roughness}|${part.metalness}|${part.emissive}|${opacity}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new StandardMaterial(`${name}:mat${materials.size}`, scene);
      const color = parseColor(part.color);
      mat.diffuseColor = color;
      const shine = 1 - Math.max(0, Math.min(1, part.roughness ?? 0.7));
      mat.specularColor = new Color3(0.25, 0.25, 0.25).scale(0.2 + shine * 1.2);
      mat.specularPower = 8 + shine * 120;
      mat.emissiveColor = color.scale(Math.max(0, Math.min(1, part.emissive ?? 0)));
      mat.alpha = opacity;
      materials.set(key, mat);
    }
    mesh.material = mat;
    mesh.parent = root;
  });
  root.setEnabled(false);
  return root;
}

/** The height of a recipe model (used to place speech bubbles and size cutouts). */
export function recipeBounds(recipe: ModelRecipe): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of recipe.parts) {
    for (let a = 0; a < 3; a++) {
      const half = Math.abs(p.size[a]) / 2;
      min[a] = Math.min(min[a], p.position[a] - half);
      max[a] = Math.max(max[a], p.position[a] + half);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [1, 1, 1] };
  return { min, max };
}
