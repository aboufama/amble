/**
 * Headless replay: ArtScripts (stroke data for the starter examples' art) and stroke logs become pixels
 * through the same brush engine as live drawing, with no view and no DOM (it runs in a page, a worker or
 * Node). The result is an ArtDoc, so art made this way is genuinely drawn in Amble.
 */
import { Board } from './board';
import { STEADY_MAX_PX, brushFor, isBrushId } from './brushes';
import { isColor } from './color';
import { PROBE_GAPS } from './fill';
import { type LogFill, type LogInit, type LogOp, type LogStroke, effectiveOps, qdt, qp, qxy } from './log';
import { type ArtDoc, type ArtLayer, type ArtOp, type ArtScript, ART_KINDS, LIMITS, RIG_KINDS, isLayerRole, makeLayer, uid } from './model';
import { Painter } from './paint';
import { lift, stamp } from './select';
import { addFrame, addLayer, clearLayer, duplicateLayer, mergeDown, moveFrame, moveLayer, noSnapshot, removeFrame, removeLayer, setFrameHold, setLayer } from './structure';
import { boardToArtDoc } from './serialize';

/** The frame id scripts draw into. */
export const SCRIPT_FRAME = 'f1';

/**
 * Screen px per canvas px a script is "drawn" at: the editor's fit zoom in a 1280x860 window (the probe's
 * default), so the input filters behave as they did when the art was previewed.
 */
export function fitScale(W: number, H: number): number {
  return Math.min((1280 - 48) / W, (860 - 48) / H);
}

const SCRIPT_BRUSHES = new Set(['ink', 'pencil', 'marker', 'crayon', 'airbrush', 'eraser', 'pixel']);
const SHAPE_BRUSHES = new Set(['ink', 'marker', 'crayon', 'pencil']);
const SHAPES = new Set(['line', 'ellipse', 'rect', 'triangle']);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Problems that stop a script from replaying (empty when it is fine). */
export function validateArtScript(s: ArtScript): string[] {
  const e: string[] = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  if (s.v !== 1) e.push('v must be 1');
  if (typeof s.name !== 'string' || !s.name) e.push('name is required');
  if (!ART_KINDS.includes(s.kind)) e.push(`kind must be one of ${ART_KINDS.join(', ')}`);
  if (s.rig !== undefined && !RIG_KINDS.includes(s.rig)) e.push(`rig must be one of ${RIG_KINDS.join(', ')}`);
  if (!isNum(s.width) || !isNum(s.height) || s.width < 1 || s.height < 1 || s.width > LIMITS.maxBoard || s.height > LIMITS.maxBoard) e.push(`width and height must be 1..${LIMITS.maxBoard}`);
  const ids = new Set<string>();
  if (!Array.isArray(s.layers) || !s.layers.length) e.push('layers must be a non-empty array');
  else {
    if (s.layers.length > LIMITS.maxLayersWithParts) e.push(`at most ${LIMITS.maxLayersWithParts} layers`);
    s.layers.forEach((l, i) => {
      if (!l || typeof l.id !== 'string' || !l.id) e.push(`layers[${i}]: id is required`);
      else if (ids.has(l.id)) e.push(`layers[${i}]: duplicate id ${l.id}`);
      else ids.add(l.id);
      const role: unknown = l?.role;
      if (!isLayerRole(role) || role === 'trace') e.push(`layers[${i}]: bad role ${String(role)}`);
    });
  }
  if (!Array.isArray(s.ops)) e.push('ops must be an array');
  else
    s.ops.forEach((op, i) => {
      const at = `ops[${i}]`;
      if (!op || typeof op !== 'object') return void e.push(`${at}: not an object`);
      if (!ids.has(op.layer)) e.push(`${at}: unknown layer ${String(op.layer)}`);
      if (!isColor(op.color)) e.push(`${at}: bad color ${String(op.color)}`);
      if (op.op === 'stroke') {
        if (!SCRIPT_BRUSHES.has(op.brush)) e.push(`${at}: bad brush ${String(op.brush)}`);
        if (!isNum(op.size) || op.size <= 0) e.push(`${at}: size must be > 0`);
        if (op.opacity !== undefined && (!isNum(op.opacity) || op.opacity < 0 || op.opacity > 1)) e.push(`${at}: opacity must be 0..1`);
        if (op.steady !== undefined && (!isNum(op.steady) || op.steady < 0 || op.steady > 1)) e.push(`${at}: steady must be 0..1`);
        if (op.dt !== undefined && (!isNum(op.dt) || op.dt <= 0 || op.dt > 1000)) e.push(`${at}: dt must be 0..1000 ms`);
        if (!Array.isArray(op.points) || !op.points.length) e.push(`${at}: points must be a non-empty array`);
        else if (!op.points.every((p) => Array.isArray(p) && p.length >= 3 && isNum(p[0]) && isNum(p[1]) && isNum(p[2]))) e.push(`${at}: each point is [x, y, pressure]`);
      } else if (op.op === 'fill') {
        if (!isNum(op.x) || !isNum(op.y)) e.push(`${at}: x and y are required`);
        if (op.tolerance !== undefined && (!isNum(op.tolerance) || op.tolerance < 0 || op.tolerance > 255)) e.push(`${at}: tolerance must be 0..255`);
      } else if (op.op === 'shape') {
        if (!SHAPES.has(op.shape)) e.push(`${at}: bad shape ${String(op.shape)}`);
        if (!SHAPE_BRUSHES.has(op.brush)) e.push(`${at}: bad shape brush ${String(op.brush)}`);
        if (!isNum(op.size) || op.size <= 0) e.push(`${at}: size must be > 0`);
        const need = op.shape === 'triangle' ? 3 : 2;
        if (!Array.isArray(op.points) || op.points.length < need || !op.points.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) e.push(`${at}: ${op.shape} needs ${need} points [x, y]`);
      } else e.push(`${at}: unknown op ${String((op as { op: unknown }).op)}`);
    });
  if (s.anchor !== undefined && !(Array.isArray(s.anchor) && isNum(s.anchor[0]) && isNum(s.anchor[1]))) e.push('anchor must be [x, y]');
  return e;
}

function scriptLayers(s: ArtScript): ArtLayer[] {
  return s.layers.map((l) => makeLayer(l.id, l.role, l.name));
}

/** Fill walls when a script leaves `underLines` out: the lines layers if any sit above the target. */
function autoSample(s: ArtScript, layer: string): LogFill['sample'] {
  const i = s.layers.findIndex((l) => l.id === layer);
  return s.layers.some((l, k) => k > i && l.role === 'lines') ? 'lines' : 'all';
}

/** Converts one script op to the log form the painter replays. */
export function scriptOpToLog(s: ArtScript, op: ArtOp, scale = fitScale(s.width, s.height)): LogOp {
  if (op.op === 'stroke') {
    const n = op.points.length;
    const xyp = new Float32Array(n * 3);
    const dts = new Uint16Array(n);
    const d = qdt(op.dt ?? 8);
    op.points.forEach(([x, y, p], i) => {
      xyp[i * 3] = qxy(x);
      xyp[i * 3 + 1] = qxy(y);
      xyp[i * 3 + 2] = qp(p);
      dts[i] = i ? d : 0;
    });
    const brush = isBrushId(op.brush) ? op.brush : 'ink';
    const stroke: LogStroke = {
      op: 'stroke',
      layer: op.layer,
      frame: SCRIPT_FRAME,
      brush,
      size: op.size,
      color: op.color,
      opacity: op.opacity ?? brushFor(brush).opacity,
      steady: op.steady ?? 0,
      input: 'pen',
      scale,
      mirror: null,
      xyp,
      dts,
    };
    return stroke;
  }
  if (op.op === 'fill') {
    return {
      op: 'fill',
      layer: op.layer,
      frame: SCRIPT_FRAME,
      x: op.x,
      y: op.y,
      color: op.color,
      tolerance: op.tolerance ?? 40,
      sample: op.underLines === undefined ? autoSample(s, op.layer) : op.underLines ? 'lines' : 'all',
      gaps: PROBE_GAPS.gaps,
      fallbackGap: PROBE_GAPS.fallbackGap,
    };
  }
  return {
    op: 'shape',
    layer: op.layer,
    frame: SCRIPT_FRAME,
    shape: op.shape,
    brush: op.brush,
    size: op.size,
    color: op.color,
    opacity: brushFor(op.brush).opacity,
    points: op.points.map(([x, y]) => [x, y] as [number, number]),
    filled: !!op.filled,
    mirror: null,
  };
}

/** The whole script as a stroke log (an init op, then one op per script op). */
export function scriptToLog(s: ArtScript): LogOp[] {
  const init: LogInit = { op: 'init', width: s.width, height: s.height, pixelArt: false, layers: scriptLayers(s), frames: [{ id: SCRIPT_FRAME, hold: 1 }] };
  const scale = fitScale(s.width, s.height);
  return [init, ...s.ops.map((op) => scriptOpToLog(s, op, scale))];
}

/** Applies one logged op to a board (the painter's). Undo/redo markers are not ops here: use effectiveOps. */
export async function applyOp(painter: Painter, op: LogOp): Promise<void> {
  const board = painter.board;
  switch (op.op) {
    case 'init':
      board.layers = op.layers.map((l) => ({ ...l }));
      board.frames = op.frames.map((f) => ({ ...f }));
      board.emit('layers', null, null, null);
      board.emit('frames', null, null, null);
      return;
    case 'stroke':
      await board.ensureFrame(op.frame);
      painter.paintLogStroke(op);
      return;
    case 'fill':
      await board.ensureFrame(op.frame);
      painter.paintLogFill(op);
      return;
    case 'shape':
      await board.ensureFrame(op.frame);
      painter.paintShape(op);
      return;
    case 'transform': {
      await board.ensureFrame(op.frame);
      if (op.action === 'part' && op.to && !board.layer(op.to.id)) addLayer(board, op.to, op.index ?? board.layers.length);
      const fl = lift(board, op.frame, op.layer, op.polygon.map(([x, y]) => ({ x, y })));
      if (!fl) return;
      if (op.action === 'move') stamp(board, op.frame, op.layer, fl, op.matrix);
      else if (op.action === 'part' && op.to) stamp(board, op.frame, op.to.id, fl, op.matrix);
      return;
    }
    case 'layer':
      switch (op.action) {
        case 'add':
          if (op.layer) addLayer(board, op.layer, op.index ?? board.layers.length);
          return;
        case 'remove':
          removeLayer(board, op.id);
          return;
        case 'move':
          moveLayer(board, op.id, op.index ?? 0);
          return;
        case 'merge':
          await mergeDown(board, op.id, noSnapshot);
          return;
        case 'duplicate':
          if (op.layer && op.source) duplicateLayer(board, op.source, op.layer, op.index ?? board.layers.length);
          return;
        case 'clear':
          await clearLayer(board, op.id, op.frame ?? null, noSnapshot);
          return;
        case 'set':
          if (op.patch) setLayer(board, op.id, op.patch);
          return;
      }
      return;
    case 'frame':
      switch (op.action) {
        case 'add':
          addFrame(board, { id: op.id, hold: op.hold ?? 1 }, op.index ?? board.frames.length, op.copyOf ?? null);
          return;
        case 'remove':
          removeFrame(board, op.id);
          return;
        case 'move':
          moveFrame(board, op.id, op.index ?? 0);
          return;
        case 'hold':
          setFrameHold(board, op.id, op.hold ?? 1);
          return;
      }
      return;
    case 'trace':
      if (!board.layer(op.layer.id)) addLayer(board, op.layer, op.index);
      return;
    case 'undo':
    case 'redo':
      return;
  }
}

export interface ReplayOptions {
  /** Called after each op (index is 0-based over the ops that draw, total excludes the init op). */
  onOp?: (index: number, total: number, op: LogOp) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Replays a stroke log (undo/redo resolved) onto a fresh board. The log must start with its init op. */
export async function replayLog(log: readonly LogOp[], o: ReplayOptions = {}): Promise<Board> {
  const ops = effectiveOps(log);
  const init = ops[0];
  if (!init || init.op !== 'init') throw new Error('replayLog: the log must start with an init op');
  const board = new Board(init.width, init.height, init.pixelArt);
  const painter = new Painter(board);
  await applyOp(painter, init);
  const total = ops.length - 1;
  for (let i = 1; i < ops.length; i++) {
    if (o.signal?.aborted) throw new DOMException('Replay aborted', 'AbortError');
    await applyOp(painter, ops[i]);
    await o.onOp?.(i - 1, total, ops[i]);
  }
  return board;
}

/**
 * Replays an ArtScript through the brush engine and returns the ArtDoc (layers as PNG cels, meta, the
 * stroke log for "Watch it drawn"). Throws with every problem when the script is invalid.
 */
export async function replayArtScript(script: ArtScript, o: ReplayOptions = {}): Promise<ArtDoc> {
  const errors = validateArtScript(script);
  if (errors.length) throw new Error(`Invalid ArtScript "${script?.name ?? '?'}": ${errors.join('; ')}`);
  const log = scriptToLog(script);
  const board = await replayLog(log, o);
  const now = Date.now();
  return boardToArtDoc(
    board,
    { id: uid('art'), name: script.name, kind: script.kind, rig: script.rig, anchor: script.anchor ? [script.anchor[0], script.anchor[1]] : null, created: now, version: 1 },
    log,
  );
}

/** Steady (0..1) to the pulled-string radius in screen px. */
export const steadyPx = (steady: number): number => Math.max(0, Math.min(1, steady)) * STEADY_MAX_PX;
