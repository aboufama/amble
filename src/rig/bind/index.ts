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
import type { BoundRig, LayerPixels, RigData, RigInput, RigPart } from '../types';
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
  /**
   * Longest side the drawing is cut at (default 512). Bigger drawings are cut from a smaller copy:
   * the mesh keeps the drawing's size, the atlas is smaller (games show drawings at half their
   * export size, so nothing visible is lost), and binding stays fast.
   */
  maxSide?: number;
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
  const maxSide = Math.max(64, opts.maxSide ?? 512);
  const { width: W, height: H } = input.image;
  if (Math.max(W, H) <= maxSide) return bindAtSize(input, rig, opts);
  const k = maxSide / Math.max(W, H);
  const t0 = performance.now();
  const small = bindAtSize(downscaleInput(input, k), scaleRig(rig, k), { ...opts, analysis: undefined });
  const rest = new Float32Array(small.rest.length);
  for (let i = 0; i < rest.length; i++) rest[i] = small.rest[i] / k;
  const art = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k });
  return {
    ...small,
    rig,
    width: W,
    height: H,
    rest,
    partRanges: small.partRanges.map((pr) => ({ ...pr, art: art(pr.art) })),
    stats: { ...small.stats, ms: performance.now() - t0 },
  };
}

function scaleRig(rig: RigData, k: number): RigData {
  return {
    ...rig,
    anchor: [rig.anchor[0] * k, rig.anchor[1] * k],
    bones: rig.bones.map((b) => ({ ...b, x: b.x * k, y: b.y * k, x2: b.x2 * k, y2: b.y2 * k })),
    skin: rig.skin?.cell ? { ...rig.skin, cell: rig.skin.cell * k } : rig.skin,
  };
}

/** Area-averaged (premultiplied) downscale of pixels. */
function downscale(p: LayerPixels, k: number): LayerPixels {
  const w = Math.max(1, Math.round(p.width * k)), h = Math.max(1, Math.round(p.height * k));
  const data = new Uint8ClampedArray(w * h * 4);
  const sx = p.width / w, sy = p.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < p.height; yy++) for (let xx = x0; xx < x1 && xx < p.width; xx++) {
        const o = (yy * p.width + xx) * 4, al = p.data[o + 3];
        r += p.data[o] * al;
        g += p.data[o + 1] * al;
        b += p.data[o + 2] * al;
        a += al;
        n++;
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        data[o] = r / a;
        data[o + 1] = g / a;
        data[o + 2] = b / a;
      }
      data[o + 3] = n ? a / n : 0;
    }
  }
  const out: LayerPixels = { data, width: w, height: h };
  if (p.x !== undefined) out.x = Math.round(p.x * k);
  if (p.y !== undefined) out.y = Math.round(p.y * k);
  return out;
}

function downscaleInput(input: RigInput, k: number): RigInput {
  const image = downscale(input.image, k);
  if (!input.layers) return { image };
  const layers: Record<string, LayerPixels> = {};
  for (const [name, l] of Object.entries(input.layers)) layers[name] = downscale(l, k);
  return { image, layers };
}

function bindAtSize(input: RigInput, rig: RigData, opts: BindOptions): BoundRig {
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
  const t1 = performance.now();
  const own = computeOwnership(A, rig, parts, boneToPart, inkAware);
  const t2 = performance.now();
  const images = cutParts(input.image, input.layers, A, rig, parts, boneToPart, adj, own, {
    hidden: opts.hidden !== false,
    bleed: opts.bleed !== false,
    inkAware,
  });
  const t3 = performance.now();
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
      stages: { analyze: t1 - t0, ownership: t2 - t1, cut: t3 - t2, mesh: performance.now() - t3 },
    },
  };
}
