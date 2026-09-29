/**
 * Drawing on the bones (§2.10, §7.3): each body part is a layer pair, a `part:<name>` layer for its colours
 * with its `<name>-lines` layer right above it, created up front in the kind's draw order (far limbs first,
 * near limbs last) so the student never manages layers. Tools route to the pair: Ink and Pencil draw the
 * part's lines; Fill, Marker, Crayon and Airbrush its colours, under the lines; the eraser works on the layer
 * the last stroke touched. Freehand uses the same routing over the plain Lines and Colours layers.
 *
 * For the rig, each pair is composited into one `part:<name>` image (lines over colours) and the union of
 * every lines layer is the exact ink mask.
 */
import { partSteps, type CharacterKind, type RigFacing } from '../cores/rig';
import type { LayerRole } from '../cores/art';
import type { PartLayers } from '../model/types';

/** A step of drawing on the bones: body, head, arms, legs, wings, tail, extras. */
export interface BonesStep {
  step: string;
  /** Part names drawn in this step (none for extras until the student adds one). */
  parts: string[];
}

export interface BonesLayout {
  steps: BonesStep[];
  /** The doc's layers, bottom to top. */
  layers: Array<{ id: string; role: LayerRole; name: string }>;
  /** Part name → its layer pair. */
  parts: Record<string, PartLayers>;
}

/** How many extras (hats, tails, hair) fit next to the parts (16 layers on the bones). */
export const MAX_LAYERS_ON_BONES = 16;

const RIG_FACING: Record<'viewer' | 'right' | 'left', RigFacing> = { viewer: 0, right: 1, left: -1 };

export function rigFacing(f: 'viewer' | 'right' | 'left'): RigFacing {
  return RIG_FACING[f];
}

/** The pair of layers for part `name`. */
export function pairIds(name: string): PartLayers {
  return { colors: name, lines: `${name}-lines` };
}

/** The layer pairs and steps for drawing a kind on its bones. */
export function bonesLayout(kind: CharacterKind, facing: RigFacing = 0): BonesLayout {
  const steps = partSteps(kind, facing);
  const all = steps.flatMap((s) => s.parts);
  const layers: BonesLayout['layers'] = [];
  const parts: Record<string, PartLayers> = {};
  for (const p of [...all].sort((a, b) => a.order - b.order)) {
    const ids = pairIds(p.name);
    parts[p.name] = ids;
    layers.push({ id: ids.colors, role: `part:${p.name}`, name: `${p.name} colours` });
    layers.push({ id: ids.lines, role: 'lines', name: `${p.name} lines` });
  }
  return { steps: steps.map((s) => ({ step: s.step, parts: s.parts.map((p) => p.name) })), layers, parts };
}

/** The name of the next extra part ('extra1', 'extra2'...), or null when no more fit. */
export function nextExtra(parts: Record<string, PartLayers>, layerCount: number): string | null {
  if (layerCount + 2 > MAX_LAYERS_ON_BONES) return null;
  for (let i = 1; i < 10; i++) if (!parts[`extra${i}`]) return `extra${i}`;
  return null;
}

/** The freehand pair: the plain Lines and Colours layers. */
export const FREEHAND_PAIR: PartLayers = { lines: 'lines', colors: 'colors' };

export type RoutedTool = 'ink' | 'pencil' | 'marker' | 'crayon' | 'airbrush' | 'eraser' | 'fill' | 'select' | 'shapes' | 'pixel' | 'eyedropper' | 'lassofill';

/**
 * The layer a tool draws on, given the pair being drawn (a part, or freehand's Lines and Colours) and the
 * layer the last stroke touched (for the eraser).
 */
export function targetLayer(tool: RoutedTool, pair: PartLayers, lastTouched: string | null): string {
  switch (tool) {
    case 'fill':
    case 'lassofill':
    case 'marker':
    case 'crayon':
    case 'airbrush':
      return pair.colors;
    case 'eraser':
      return lastTouched ?? pair.lines;
    default:
      return pair.lines;
  }
}

/** The part pair a layer belongs to, if any. */
export function partOfLayer(parts: Record<string, PartLayers>, layer: string): string | null {
  for (const [name, p] of Object.entries(parts)) if (p.lines === layer || p.colors === layer) return name;
  return null;
}

/**
 * Composites a part for the rig: its lines over its colours (straight RGBA, both `W` wide, same size),
 * source-over. Pure (unit-tested); the Desk runs the same on canvases.
 */
export function compositePair(colors: Uint8ClampedArray | null, lines: Uint8ClampedArray | null, W: number, H: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  if (colors) out.set(colors.subarray(0, W * H * 4));
  if (!lines) return out;
  for (let i = 0; i < W * H * 4; i += 4) {
    const a = lines[i + 3] / 255;
    if (a <= 0) continue;
    const ad = out[i + 3] / 255;
    const ao = a + ad * (1 - a);
    for (let k = 0; k < 3; k++) out[i + k] = (lines[i + k] * a + out[i + k] * ad * (1 - a)) / ao;
    out[i + 3] = ao * 255;
  }
  return out;
}

/** The rig's ink mask: the union of every lines layer (the most opaque ink at each pixel). */
export function inkUnion(lines: ReadonlyArray<Uint8ClampedArray | null>, W: number, H: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (const l of lines) {
    if (!l) continue;
    for (let i = 0; i < W * H * 4; i += 4)
      if (l[i + 3] > out[i + 3]) {
        out[i] = l[i];
        out[i + 1] = l[i + 1];
        out[i + 2] = l[i + 2];
        out[i + 3] = l[i + 3];
      }
  }
  return out;
}

/** The side a part is on (L/R are the screen's left and right), for "Copy it to the other side". */
export function otherSide(name: string): string | null {
  const m = /^(arm|leg|wing|legF|legB)([LR])$/.exec(name);
  if (!m) return null;
  return `${m[1]}${m[2] === 'L' ? 'R' : 'L'}`;
}

/**
 * The board transform that carries part `from` onto the opposite part: a mirror about the spine for
 * characters facing the viewer, a plain shift between the two bones' roots for side views.
 */
export function mirrorMatrix(fromRoot: [number, number], toRoot: [number, number], spineX: number, facingViewer: boolean): [number, number, number, number, number, number] {
  if (facingViewer) return [-1, 0, 0, 1, 2 * spineX, 0];
  return [1, 0, 0, 1, toRoot[0] - fromRoot[0], toRoot[1] - fromRoot[1]];
}
