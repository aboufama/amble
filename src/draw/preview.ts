/**
 * What the Desk's previews play (§2.10): the drawing so far with bones, as the rig preview ("It already
 * moves!") and the running world ("In your world") take it.
 * - On the bones: the template skeleton moved into the preview export's pixels, with each drawn part as its
 *   own layer, so parts move on the bones they were drawn on and undrawn bones show as a constellation.
 * - In Freehand: the kind's auto-rig in the rig worker (over the star-pose guide's joints when drawn over
 *   it), latest wins.
 * - Things with no bones play as their picture.
 * Bring to life drops the previews' waiting rig jobs (`dropPreviewJobs`): they would run before it in the rig
 * worker's queue, and the drawing is about to fly into the world anyway.
 */
import type { DrawnArt } from '../cores/play';
import { rigWorker, type CharacterKind, type JointHints, type RigData } from '../cores/rig';
import type { DeskArt } from './deskController';
import { rigFacing } from './parts';
import type { DeskRequest } from './request';

/** The Freehand preview's auto-rig lane. */
export const PREVIEW_LANE = 'desk-preview';

/** The rig worker lanes of the Desk's previews: its Freehand auto-rig, and each rig preview's bind (`preview-<n>`). */
export function isPreviewLane(lane: string): boolean {
  return lane === PREVIEW_LANE || lane.startsWith('preview-');
}

/** Bring to life goes first: the previews' rig jobs still waiting in the queue are dropped (their previews keep their picture). */
export function dropPreviewJobs(): number {
  return rigWorker.drop(isPreviewLane);
}

/** A board-space rig moved into the pixels of an export (trimmed at `box`, scaled by `scale`). */
export function rigOnExport(rig: RigData, box: readonly [number, number, number, number], scale: number): RigData {
  const px = (x: number, y: number): [number, number] => [(x - box[0]) * scale, (y - box[1]) * scale];
  return {
    ...rig,
    anchor: px(rig.anchor[0], rig.anchor[1]),
    bones: rig.bones.map((b) => {
      const [x, y] = px(b.x, b.y);
      const [x2, y2] = px(b.x2, b.y2);
      return { ...b, x, y, x2, y2 };
    }),
    artHash: '',
  };
}

/** Board-space joint hints moved into an export's pixels. */
export function hintsOnExport(hints: JointHints, box: readonly [number, number, number, number], scale: number): JointHints {
  const out: JointHints = {};
  for (const [role, p] of Object.entries(hints)) if (p) out[role as keyof JointHints] = [(p[0] - box[0]) * scale, (p[1] - box[1]) * scale];
  return out;
}

export interface PreviewRig {
  rig: RigData | null;
  /** `part:<name>` → its image (on the bones). */
  layers: Record<string, Blob> | null;
}

/**
 * The bones the previews play `art` with. `template` is the kind's skeleton on the board (null for things
 * without bones); `guide` the star-pose joints when drawn over the guide.
 */
export async function previewRig(art: DeskArt, request: Pick<DeskRequest, 'kind' | 'rig' | 'facing'>, template: RigData | null, guide: JointHints | null): Promise<PreviewRig> {
  if (request.kind !== 'character' || request.rig === 'none' || !template) return { rig: null, layers: null };
  if (art.mode === 'bones' && art.parts.length) {
    const layers: Record<string, Blob> = {};
    for (const p of art.parts) layers[`part:${p.name}`] = p.png;
    return { rig: rigOnExport(template, art.box, art.scale), layers };
  }
  const kind = request.rig as CharacterKind;
  try {
    const r = await rigWorker.autoRig(
      { image: art.flat },
      {
        kind,
        lane: PREVIEW_LANE,
        facing: rigFacing(request.facing),
        ...(guide ? { hints: hintsOnExport(guide, art.box, art.scale), unsnapped: 'keep' as const } : {}),
      },
    );
    return { rig: r.rig, layers: null };
  } catch {
    // Superseded by a newer drawing, or no bones found: the picture still shows.
    return { rig: null, layers: null };
  }
}

/** The drawing as the running world takes it (`PlayerHost.swapArt`). */
export function drawnArtOf(key: string, art: DeskArt, r: PreviewRig): DrawnArt {
  const out: DrawnArt = { key, image: art.flat };
  if (r.rig) out.rig = r.rig;
  if (r.layers) out.layers = r.layers;
  return out;
}
