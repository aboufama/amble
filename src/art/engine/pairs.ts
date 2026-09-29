/**
 * Part pairs (drawing on the bones, §7.3): each body part is a `part:<name>` layer holding its colours and a
 * `lines` layer holding its ink, right above it. The pair's lines layer has the part layer's id plus
 * `-lines` (the art department's scripts and the Desk both name them so); a lines layer directly above a
 * part layer also counts, for drawings whose ids were made another way.
 *
 * A pair is one drawing inside the drawing: a fill on the part layer is walled by its own lines only (an
 * arm drawn across the torso does not cut holes in the torso's colour), and a selection lifts the pair.
 */
import { type ArtLayer, isPartRole } from './model';

/** The lines layer paired with part layer `partId`, or null. */
export function pairedLines(layers: readonly ArtLayer[], partId: string): string | null {
  const i = layers.findIndex((l) => l.id === partId);
  if (i < 0 || !isPartRole(layers[i].role)) return null;
  const named = layers.find((l) => l.id === `${partId}-lines` && l.role === 'lines');
  if (named) return named.id;
  const above = layers[i + 1];
  return above && above.role === 'lines' && !pairedPartOf(layers, above.id, false) ? above.id : null;
}

/** The part layer that lines layer `linesId` belongs to, or null (a freehand Lines layer). */
export function pairedPart(layers: readonly ArtLayer[], linesId: string): string | null {
  return pairedPartOf(layers, linesId, true);
}

function pairedPartOf(layers: readonly ArtLayer[], linesId: string, byPosition: boolean): string | null {
  const i = layers.findIndex((l) => l.id === linesId);
  if (i < 0 || layers[i].role !== 'lines') return null;
  if (linesId.endsWith('-lines')) {
    const base = linesId.slice(0, -'-lines'.length);
    const part = layers.find((l) => l.id === base && isPartRole(l.role));
    if (part) return part.id;
  }
  if (!byPosition) return null;
  const below = layers[i - 1];
  if (!below || !isPartRole(below.role)) return null;
  // The part below may be paired by name with another lines layer.
  const named = layers.find((l) => l.id === `${below.id}-lines` && l.role === 'lines');
  return named && named.id !== linesId ? null : below.id;
}

/** Both layers of the pair `id` belongs to ([part, lines]), or null when it is not in a pair. */
export function pairOf(layers: readonly ArtLayer[], id: string): [string, string] | null {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return null;
  if (isPartRole(layer.role)) {
    const lines = pairedLines(layers, id);
    return lines ? [id, lines] : null;
  }
  const part = pairedPart(layers, id);
  return part ? [part, id] : null;
}
