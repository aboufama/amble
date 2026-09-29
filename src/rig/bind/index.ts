/**
 * Binding: drawing + bones → part atlas, lattice meshes and bone weights (`BoundRig`). Deterministic
 * and never stored: cache it (or bake it) by `bindKey()`. About 20-80 ms per drawing on a desktop,
 * 3-4× on a Chromebook, so run it in the rig worker.
 *
 * The deformation model is "cut-out between parts, skinning within parts": each part is its own mesh
 * (neighbours never share triangles), bent smoothly at the joints inside it (elbows, knees,
 * spine/hips) and pinned rigidly to the next part like a paper doll, with the hidden pixels behind
 * every pin synthesized.
 */
import { analyze, type Analysis } from '../analyze';
import { defaultParts } from '../parts';
import type { BoundRig, RigData, RigInput, RigPart } from '../types';
import { cutParts } from './cut';
import { buildMesh } from './mesh';
import { computeOwnership } from './ownership';

export interface BindOptions {
  /** Reuse an analysis of the same pixels at `BIND_WORK_SIZE` (saves 20-40 ms); others are ignored. */
  analysis?: Analysis;
  /** Lattice cell in art px (default: from the drawing's area, or `rig.skin.cell`). */
  cell?: number;
  /** Blend band as a multiple of the limb radius at each joint (default 0.8, or `rig.skin.blend`). */
  blend?: number;
  /** Part borders follow the drawn ink lines (default true). */
  inkAware?: boolean;
  /** Synthesize hidden areas at joints of flat drawings (default true). */
  hidden?: boolean;
  /** Bleed each part 2 px across its cut edges with its own colours (default true). */
  bleed?: boolean;
  /** Also blend weights across part joints (rubber-hose joints between parts). Default false. */
  softPartJoints?: boolean;
}

export { defaultParts };

/**
 * Binding always analyses at this working size, whatever size the auto-rig used, so the same art and
 * bones always give the same mesh (bakes are cached by content).
 */
export const BIND_WORK_SIZE = 240;

export function bindScale(input: RigInput): number {
  return Math.min(1, BIND_WORK_SIZE / Math.max(input.image.width, input.image.height));
}

export function bindRig(input: RigInput, rig: RigData, opts: BindOptions = {}): BoundRig {
  const t0 = performance.now();
  const A = opts.analysis && Math.abs(opts.analysis.scale - bindScale(input)) < 1e-9 && opts.analysis.artW === input.image.width
    ? opts.analysis
    : analyze(input, { workSize: BIND_WORK_SIZE });
  const bones = rig.bones;
  const nb = bones.length;
  const parts: RigPart[] = (rig.parts?.length ? rig.parts : defaultParts(rig)).slice().sort((a, b) => a.order - b.order);
  const np = parts.length;
  const boneToPart = new Int16Array(nb).fill(0);
  const index = new Map(bones.map((b, i) => [b.name, i] as [string, number]));
  parts.forEach((p, k) => p.bones.forEach((n) => {
    const i = index.get(n);
    if (i !== undefined) boneToPart[i] = k;
  }));
  const adj: boolean[][] = parts.map(() => new Array<boolean>(np).fill(false));
  bones.forEach((b, i) => {
    if (b.parent < 0) return;
    const pa = boneToPart[i], pb = boneToPart[b.parent];
    adj[pa][pb] = adj[pb][pa] = true;
  });
  // roots sharing a joint (hips and spine at the pelvis) make their parts adjacent too
  for (let i = 0; i < nb; i++) for (let j = 0; j < nb; j++) {
    if (i !== j && bones[i].parent === bones[j].parent && Math.hypot(bones[i].x - bones[j].x, bones[i].y - bones[j].y) < 1.5 / A.scale) {
      adj[boneToPart[i]][boneToPart[j]] = true;
    }
  }
  const inkAware = opts.inkAware !== false;
  const own = computeOwnership(A, rig, parts, boneToPart, inkAware);
  const images = cutParts(input.image, input.layers, A, rig, parts, boneToPart, adj, own, {
    hidden: opts.hidden !== false,
    bleed: opts.bleed !== false,
    inkAware,
  });
  const mesh = buildMesh(input.image, A, rig, parts, boneToPart, adj, own, images, {
    cell: opts.cell,
    blend: opts.blend ?? rig.skin?.blend ?? 0.8,
    softPartJoints: opts.softPartJoints === true,
  });
  const { cell, ...arrays } = mesh;
  return {
    rig,
    ...arrays,
    flat: !parts.some((p) => p.layer && input.layers?.[p.layer]),
    stats: {
      vertices: mesh.rest.length / 2,
      triangles: mesh.indices.length / 3,
      parts: np,
      atlasW: mesh.atlas.width,
      atlasH: mesh.atlas.height,
      cell,
      ms: performance.now() - t0,
    },
  };
}
