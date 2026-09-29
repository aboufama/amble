/**
 * Amble's art engine: a framework-free drawing engine for the Draw room.
 *
 * Every picture in a student's game is drawn here by the student. The engine is Canvas 2D for display plus
 * its own stroke rasterizer in TypeScript (SDF capsules with max-union: pressure, tapers, no beading or
 * seams), with each layer's pixels kept on the CPU (so commits, fills, undo and export never wait on a GPU
 * readback, and replay runs anywhere, Node included).
 *
 * WHAT IT DOES
 * - Brushes: ink, pencil, marker, crayon, airbrush, eraser (hard/soft) and a pixel pen for pixel art, with
 *   size, opacity, Steady (stabilizer) and colour; pressure, taper and speed from pen, finger or mouse.
 * - Canvas: two-finger (or trackpad) pan/pinch/rotate with a CSS transform during the gesture and a crisp
 *   redraw after; two-finger tap = undo, three-finger tap = redo; fingers only navigate once a pen is seen.
 * - Layers with roles: lines (ink, on top), colors (fills land here, under the lines), sketch (never
 *   exported), part:<name> (a body part for rigging), trace (a photo, never exported) and paint; each with
 *   visibility, lock, opacity, order, merge, normal/multiply blend and alpha lock.
 * - Fill that closes gaps: picks the smallest gap that seals the tapped region (and splits two inner
 *   regions that touch through a gap), taps on a line fill the nearest side, background taps never bleed
 *   into shapes, "fill under the lines"; analysis precomputed in a worker.
 * - Hold to perfect (line, circle, ellipse, triangle, rectangle) and a "make it perfect" button; mirror
 *   (vertical axis, optional horizontal); lasso/rectangle selection with move/scale/rotate/flip and "make
 *   this a part" (it lifts the lines, colours and paint layers together unless scope is 'layer'); eyedropper; flipbook frames with onion skin; undo/redo for everything; the stroke log and
 *   "Watch it drawn"; a guide overlay; export for the game and the rigger; headless replay of ArtScripts.
 *
 * USAGE (the Draw room)
 *
 *   import { createArtSurface } from './art/engine';
 *
 *   const surface = createArtSurface(hostDiv, savedDocOrNull, { width: 1024, height: 1024, kind: 'character' });
 *   await surface.ready;
 *   surface.on('history', (h) => setUndoEnabled(h.canUndo));   // coarse events only, never per pointer event
 *   surface.on('toast', (t) => showToast(t.message));           // "Perfect circle!", "Closed a 7 px gap"
 *   surface.on('commit', () => autosaveSoon());                 // after every stroke, fill, layer change...
 *   surface.setTool('ink');
 *   surface.setBrush({ size: 8, steady: 0.2 });
 *   surface.setColor('#2b1d16');
 *   surface.setGuide({ groundY: 900, showAnchor: true, sizeRef: { image: heroBitmap, box: { x: 60, y: 420, w: 200, h: 480 }, label: 'Pip, for size' } });
 *   ...
 *   const doc = await surface.toArtDoc();          // store in IndexedDB as is (Blobs clone fine)
 *   surface.markSaved();
 *   const art = await surface.export({ scale: 0.5 }); // flat PNG + anchor, part PNGs, ink mask, thumb
 *   surface.destroy();
 *
 * USAGE (starter examples, drawn by script through the same brushes, no UI)
 *
 *   import { replayArtScript } from './art/engine';
 *   const doc = await replayArtScript(script, { onOp: (i, total) => progress(i / total) });
 *
 * USAGE ("Watch it drawn")
 *
 *   const player = playTimelapse(hostDiv, doc, { speed: 8 });
 *   player.on('progress', ({ index, total }) => ...);
 *
 * CONTRACTS
 * - Coordinates are board pixels (origin top-left) everywhere except view helpers.
 * - ArtDoc cels are lossless PNGs trimmed to content; master art is always PNG.
 * - Exports never include sketch or trace layers, or the guide; they are transparent and trimmed (not
 *   backgrounds). The anchor is the ArtDoc's override or automatic: characters stand on the centre of
 *   their feet (bottom 4% of rows), terrain hangs from its top centre, everything else uses the centre.
 * - The lines layers alone (visible ones) are the rigger's exact ink mask (`ArtExport.linesMask`).
 * - Budgets (4 GB Chromebook): board <= 2048 px a side, <= 12 layers (16 with part layers), <= 24 frames,
 *   undo <= 96 MB, idle frames packed beyond 128 MB of pixels, stroke log <= 400k samples. A 1024 board
 *   costs 4 MB per non-empty layer plus a 4 MB display copy for the active frame.
 */

export { createArtSurface } from './surface';
export type {
  ArtSurface,
  ArtSurfaceOptions,
  BrushSettings,
  FrameInfo,
  GapsMode,
  HistoryState,
  LayerInfo,
  PerfStats,
  SelectionInfo,
  SurfaceEvents,
  ToastKind,
  ToolId,
  ToolState,
} from './surface-types';
export { TOOL_IDS } from './surface-types';

export { replayArtScript, replayLog, scriptToLog, validateArtScript, fitScale, applyOp, SCRIPT_FRAME } from './replay';
export type { ReplayOptions } from './replay';
export { playTimelapse } from './timelapse';
export type { Timelapse, TimelapseEvents, TimelapseOptions } from './timelapse';

export type { ArtDoc, ArtLayer, ArtFrame, ArtCel, ArtKind, RigKind, LayerRole, LayerBlendMode, ArtScript, ArtOp, ScriptBrush } from './model';
export { LIMITS, ART_KINDS, RIG_KINDS, EXPORTED_ROLES, isLayerRole, isPartRole, partName, makeLayer } from './model';
export { serializeArtDoc, deserializeArtDoc, validateArtDoc, artDocBytes, readLog } from './serialize';

export type { ArtExport, ExportOptions, LayerExport, FrameExport, PngImage } from './export';
export type { Guide, GuideItem, GuideImage } from './guide';
export type { LogOp, LogStroke, LogFill, LogShape, LogTransform, LogLayer, LogFrame, LogInit, LogTrace, InputKind } from './log';
export { effectiveOps, encodeLog, decodeLog } from './log';
export type { BrushId, Brush } from './brushes';
export { BRUSHES, BRUSH_IDS, STEADY_MAX_PX } from './brushes';
export type { PerfectKind } from './shape';
export type { SelectionTransform } from './select';
export type { SelectScope } from './selection-tool';
export { selectionLayers } from './selection-tool';
export type { ViewState } from './view';
export { encodePng, decodePng } from './png';

import type { ArtDoc, ArtKind } from './model';
import type { ArtExport, ExportOptions, FrameExport } from './export';
import { exportArt, exportFrames } from './export';
import { artDocToBoard } from './serialize';

/**
 * Exports an ArtDoc without a surface (for the rigger, the examples or a worker): the flat PNG with its
 * anchor, part and layer PNGs, the lines-only ink mask and a thumbnail.
 */
export async function exportArtDoc(doc: ArtDoc, o: ExportOptions = {}): Promise<ArtExport | null> {
  const board = await artDocToBoard(doc);
  return exportArt(board, { kind: doc.kind as ArtKind, anchor: doc.anchor, ...o });
}

/** Every flipbook frame of an ArtDoc, trimmed and placed in their common box. */
export async function exportArtDocFrames(doc: ArtDoc, o: { scale?: number } = {}): Promise<{ box: [number, number, number, number]; scale: number; frames: FrameExport[] } | null> {
  return exportFrames(await artDocToBoard(doc), o);
}
