/**
 * The stroke log: every operation, in order, with stroke samples quantized at the input boundary (1/256 px,
 * 1/4096 pressure, 0.1 ms), so a replay feeds the engine exactly what the live stroke got and reproduces the
 * same pixels. It powers "Watch it drawn" and crash recovery. Undo and redo are logged too; `effectiveOps`
 * drops what was undone.
 */
import type { BrushId } from './brushes';
import type { ArtFrame, ArtLayer } from './model';
import type { Symmetry } from './stroke';

export type InputKind = 'pen' | 'mouse' | 'touch';

export interface LogStroke {
  op: 'stroke';
  layer: string;
  frame: string;
  brush: BrushId;
  size: number;
  color: string;
  opacity: number;
  /** Stabilizer 0..1. */
  steady: number;
  /** Soft eraser. */
  soft?: boolean;
  input: InputKind;
  /** Virtual screen px per document px when it was drawn (the filters' scale). */
  scale: number;
  mirror: Symmetry | null;
  /** Hold to perfect snapped after this many samples. */
  snap?: number;
  /** Samples: x, y, pressure interleaved (quantized). */
  xyp: Float32Array;
  /** Per-sample time step in 0.1 ms (the first is 0). */
  dts: Uint16Array;
}

export type FillSample = 'lines' | 'all' | 'layer';

export interface LogFill {
  op: 'fill';
  layer: string;
  frame: string;
  x: number;
  y: number;
  color: string;
  tolerance: number;
  /** Where the walls came from: the lines layers, everything visible, or the target layer itself. */
  sample: FillSample;
  gaps: number[];
  fallbackGap: number;
  /**
   * 'lines' fills on a body part: the one lines layer that walled it (the part's pair). Absent: every
   * visible lines layer, or the pair when the target is a part layer that has one (older logs, scripts).
   */
  lines?: string;
  /** "Fill all of this colour": every pixel of the tapped colour on the layer, wherever it is. */
  all?: true;
}

export interface LogShape {
  op: 'shape';
  layer: string;
  frame: string;
  /** polygon: its corners, closed (lasso fill); curve: a smooth curve through the points. */
  shape: 'line' | 'ellipse' | 'rect' | 'triangle' | 'polygon' | 'curve';
  brush: BrushId;
  size: number;
  color: string;
  opacity: number;
  points: [number, number][];
  filled: boolean;
  mirror: Symmetry | null;
  /** Draw the outline with the brush (default true); false = only the fill (lasso fill, filled shapes). */
  outline?: boolean;
}

export type Affine6 = [number, number, number, number, number, number];

export interface LogTransform {
  op: 'transform';
  /** The active layer. */
  layer: string;
  /** Every layer the selection lifted, bottom to top (default [layer]). */
  layers?: string[];
  frame: string;
  /** The selection outline (document px). */
  polygon: [number, number][];
  /** Where the lifted pixels land: x' = a x + c y + e, y' = b x + d y + f. */
  matrix: Affine6;
  /**
   * move: put back transformed; delete: drop them; part: all of them, merged (each layer's opacity and
   * blend), onto a new layer `to` (created by this op).
   */
  action: 'move' | 'delete' | 'part';
  /** part: the new layer and its index (bottom = 0). */
  to?: ArtLayer;
  index?: number;
}

export interface LogLayer {
  op: 'layer';
  action: 'add' | 'remove' | 'move' | 'merge' | 'duplicate' | 'clear' | 'set';
  id: string;
  /** add / duplicate: the new layer. */
  layer?: ArtLayer;
  /** add / move / duplicate: the new index (bottom = 0). */
  index?: number;
  /** duplicate: the source layer id. */
  source?: string;
  patch?: Partial<Omit<ArtLayer, 'id'>>;
  /** clear: the frame (all frames when absent). */
  frame?: string;
}

export interface LogFrame {
  op: 'frame';
  action: 'add' | 'remove' | 'move' | 'hold';
  id: string;
  index?: number;
  /** add: copy this frame's pictures (a duplicate). */
  copyOf?: string | null;
  hold?: number;
}

export interface LogInit {
  op: 'init';
  width: number;
  height: number;
  pixelArt: boolean;
  layers: ArtLayer[];
  frames: ArtFrame[];
}

/** A photo was placed on a new trace layer (the photo itself is not logged; trace layers never export). */
export interface LogTrace {
  op: 'trace';
  layer: ArtLayer;
  index: number;
}

export type LogOp = LogInit | LogStroke | LogFill | LogShape | LogTransform | LogLayer | LogFrame | LogTrace | { op: 'undo' } | { op: 'redo' };

// ---------------------------------------------------------------------------------------------- quantization

export const qxy = (v: number): number => Math.round(v * 256) / 256;
export const qp = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 4096) / 4096;
/** ms -> 0.1 ms units, clamped to uint16. */
export const qdt = (ms: number): number => Math.max(0, Math.min(65535, Math.round(ms * 10)));

/** Growable sample buffer for a stroke being drawn. */
export class SampleBuffer {
  xyp = new Float32Array(3 * 256);
  dts = new Uint16Array(256);
  n = 0;
  private rawT = 0;
  private t = 0;

  /**
   * Adds a sample (document px, pressure, event time in ms) and returns the quantized values the engine must
   * use; `t` accumulates exactly as `sampleTimes` does on replay.
   */
  push(x: number, y: number, p: number, tMs: number): { x: number; y: number; p: number; t: number } {
    if (this.n === this.dts.length) {
      const xyp = new Float32Array(this.xyp.length * 2);
      xyp.set(this.xyp);
      this.xyp = xyp;
      const dts = new Uint16Array(this.dts.length * 2);
      dts.set(this.dts);
      this.dts = dts;
    }
    let d = 0;
    if (this.n === 0) this.rawT = tMs;
    else {
      d = qdt(tMs - this.rawT);
      // Stay on the quantized grid so rounding never accumulates.
      this.rawT += d / 10;
      this.t += d / 10;
    }
    const k = this.n * 3;
    this.xyp[k] = qxy(x);
    this.xyp[k + 1] = qxy(y);
    this.xyp[k + 2] = qp(p);
    this.dts[this.n] = d;
    this.n++;
    return { x: this.xyp[k], y: this.xyp[k + 1], p: this.xyp[k + 2], t: this.t };
  }

  take(): { xyp: Float32Array; dts: Uint16Array } {
    return { xyp: this.xyp.slice(0, this.n * 3), dts: this.dts.slice(0, this.n) };
  }
}

/** Engine times (ms) for a logged stroke's samples. */
export function sampleTimes(dts: Uint16Array): Float64Array {
  const t = new Float64Array(dts.length);
  for (let i = 1; i < dts.length; i++) t[i] = t[i - 1] + dts[i] / 10;
  return t;
}

// ---------------------------------------------------------------------------------------------- undo/redo

/**
 * The ops that make up the current state: undone ops are dropped. Every op other than init/undo/redo is
 * one undo step. ("Make it perfect" after a stroke is logged as an undo plus the stroke again with `snap`.)
 */
export function effectiveOps(log: readonly LogOp[]): LogOp[] {
  const applied: LogOp[] = [];
  const redo: LogOp[] = [];
  for (const op of log) {
    if (op.op === 'undo') {
      for (let i = applied.length - 1; i >= 0; i--) {
        if (applied[i].op === 'init') continue;
        redo.push(applied.splice(i, 1)[0]);
        break;
      }
    } else if (op.op === 'redo') {
      const r = redo.pop();
      if (r) applied.push(r);
    } else {
      applied.push(op);
      if (op.op !== 'init') redo.length = 0;
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------------------------- binary format

class Writer {
  buf = new Uint8Array(1024);
  n = 0;
  private ensure(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  u8(v: number): void {
    this.ensure(1);
    this.buf[this.n++] = v;
  }
  varint(v: number): void {
    this.ensure(10);
    let x = Math.floor(v);
    while (x >= 128) {
      this.buf[this.n++] = (x % 128) | 128;
      x = Math.floor(x / 128);
    }
    this.buf[this.n++] = x;
  }
  zigzag(v: number): void {
    this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  bytes(b: Uint8Array): void {
    this.varint(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  text(s: string): void {
    this.bytes(new TextEncoder().encode(s));
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

class Reader {
  n = 0;
  constructor(private buf: Uint8Array) {}
  u8(): number {
    if (this.n >= this.buf.length) throw new Error('stroke log: truncated');
    return this.buf[this.n++];
  }
  varint(): number {
    let v = 0;
    let mul = 1;
    for (;;) {
      const b = this.u8();
      v += (b & 127) * mul;
      if (b < 128) return v;
      mul *= 128;
      if (mul > 2 ** 56) throw new Error('stroke log: bad varint');
    }
  }
  zigzag(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
  bytes(): Uint8Array {
    const len = this.varint();
    if (this.n + len > this.buf.length) throw new Error('stroke log: truncated');
    const b = this.buf.subarray(this.n, this.n + len);
    this.n += len;
    return b;
  }
  text(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

const MAGIC = [0x41, 0x4d, 0x4c, 0x47]; // 'AMLG'
const VERSION = 1;
const KIND_STROKE = 1;
const KIND_JSON = 2;

/** Encodes a log compactly: stroke samples as zigzag varint deltas, everything else as JSON. */
export function encodeLog(log: readonly LogOp[]): Uint8Array {
  const w = new Writer();
  for (const b of MAGIC) w.u8(b);
  w.u8(VERSION);
  w.varint(log.length);
  for (const op of log) {
    if (op.op !== 'stroke') {
      w.u8(KIND_JSON);
      w.text(JSON.stringify(op));
      continue;
    }
    w.u8(KIND_STROKE);
    const { xyp, dts, ...head } = op;
    w.text(JSON.stringify(head));
    const n = dts.length;
    w.varint(n);
    let px = 0;
    let py = 0;
    let pp = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.round(xyp[i * 3] * 256);
      const y = Math.round(xyp[i * 3 + 1] * 256);
      const p = Math.round(xyp[i * 3 + 2] * 4096);
      w.zigzag(x - px);
      w.zigzag(y - py);
      w.zigzag(p - pp);
      w.varint(dts[i]);
      px = x;
      py = y;
      pp = p;
    }
  }
  return w.done();
}

export function decodeLog(bytes: Uint8Array): LogOp[] {
  const r = new Reader(bytes);
  for (const b of MAGIC) if (r.u8() !== b) throw new Error('stroke log: bad magic');
  const version = r.u8();
  if (version !== VERSION) throw new Error(`stroke log: unsupported version ${version}`);
  const count = r.varint();
  const out: LogOp[] = [];
  for (let k = 0; k < count; k++) {
    const kind = r.u8();
    if (kind === KIND_JSON) {
      out.push(JSON.parse(r.text()) as LogOp);
      continue;
    }
    if (kind !== KIND_STROKE) throw new Error('stroke log: bad op');
    const head = JSON.parse(r.text()) as Omit<LogStroke, 'xyp' | 'dts'>;
    const n = r.varint();
    const xyp = new Float32Array(n * 3);
    const dts = new Uint16Array(n);
    let px = 0;
    let py = 0;
    let pp = 0;
    for (let i = 0; i < n; i++) {
      px += r.zigzag();
      py += r.zigzag();
      pp += r.zigzag();
      xyp[i * 3] = px / 256;
      xyp[i * 3 + 1] = py / 256;
      xyp[i * 3 + 2] = pp / 4096;
      dts[i] = r.varint();
    }
    out.push({ ...head, xyp, dts });
  }
  return out;
}

/** Total stroke samples in a log (for the recording budget). */
export function logSamples(log: readonly LogOp[]): number {
  let n = 0;
  for (const op of log) if (op.op === 'stroke') n += op.dts.length;
  return n;
}
