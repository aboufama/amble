/**
 * "Watch it drawn": replays a drawing's stroke log (or an ArtScript) on a read-only view, strokes appearing
 * as they were drawn, at N times the real speed. The engine is deterministic, so the last frame is the
 * drawing.
 */
import { Board } from './board';
import { Compositor } from './compositor';
import { Emitter } from './events';
import { type LogOp, type LogStroke, effectiveOps, sampleTimes } from './log';
import type { ArtDoc, ArtScript } from './model';
import { Painter, specOfLog } from './paint';
import { applyOp, scriptToLog } from './replay';
import { readLog } from './serialize';
import { fitView } from './view';

export interface TimelapseOptions {
  /** Times real speed (default 8). */
  speed?: number;
  /** Longest a single stroke may take on screen, ms (default 1500). */
  maxStrokeMs?: number;
  paper?: string;
  workspace?: string;
  /** Start playing when ready (default true). */
  autoplay?: boolean;
}

export interface TimelapseEvents {
  progress: { index: number; total: number };
  end: void;
}

export interface Timelapse {
  readonly ready: Promise<void>;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  /** Jumps to just after op `index` (-1 = the empty page), instantly. */
  seek(index: number): Promise<void>;
  progress(): { index: number; total: number };
  on<K extends keyof TimelapseEvents>(type: K, fn: (e: TimelapseEvents[K]) => void): () => void;
  destroy(): void;
}

async function opsOf(source: ArtDoc | ArtScript | readonly LogOp[]): Promise<LogOp[]> {
  if (Array.isArray(source)) return effectiveOps(source as LogOp[]);
  if ((source as ArtDoc).format === 'amble-art') {
    const log = await readLog(source as ArtDoc);
    if (!log) throw new Error('This drawing has no stroke log to replay');
    return effectiveOps(log);
  }
  return effectiveOps(scriptToLog(source as ArtScript));
}

class Player implements Timelapse {
  readonly ready: Promise<void>;
  private readonly em = new Emitter<TimelapseEvents>();
  private ops: LogOp[] = [];
  private board: Board | null = null;
  private painter: Painter | null = null;
  private comp: Compositor | null = null;
  private index = -1;
  private speed: number;
  private run = 0;
  private destroyed = false;
  private resizeObs: ResizeObserver | null = null;
  private preview: { buf: Uint8ClampedArray; img: ImageData } | null = null;
  playing = false;

  constructor(
    private readonly host: HTMLElement,
    source: ArtDoc | ArtScript | readonly LogOp[],
    private readonly o: TimelapseOptions,
  ) {
    this.speed = Math.max(0.25, o.speed ?? 8);
    this.ready = (async () => {
      this.ops = await opsOf(source);
      if (!this.ops.length || this.ops[0].op !== 'init') throw new Error('The stroke log does not start at the beginning');
      await this.reset();
      if (o.autoplay !== false) this.play();
    })();
  }

  private get total(): number {
    return this.ops.length - 1;
  }

  progress(): { index: number; total: number } {
    return { index: this.index, total: this.total };
  }

  on<K extends keyof TimelapseEvents>(type: K, fn: (e: TimelapseEvents[K]) => void): () => void {
    return this.em.on(type, fn);
  }

  private async reset(): Promise<void> {
    const init = this.ops[0];
    if (init.op !== 'init') return;
    this.comp?.destroy();
    const board = new Board(init.width, init.height, init.pixelArt);
    this.board = board;
    this.painter = new Painter(board);
    await applyOp(this.painter, init);
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.host.style.overflow = 'hidden';
    this.host.style.background = this.o.workspace ?? '#e6e1d8';
    const comp = new Compositor(this.host, board, board.frames[0].id, board.layers[board.layers.length - 1].id, { paper: this.o.paper ?? '#fffdf7', workspace: this.o.workspace ?? '#e6e1d8', desynchronized: false });
    this.comp = comp;
    const img = new ImageData(board.W, board.H);
    this.preview = { buf: img.data, img };
    board.listen((kind, frame, layer, rect) => {
      if (kind === 'pixels') {
        if (frame === comp.frame && layer) comp.layerChanged(layer, rect ?? { x0: 0, y0: 0, x1: board.W, y1: board.H });
      } else comp.reload();
    });
    comp.reload();
    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => {
      if (comp.measure()) {
        comp.view = fitView(board.W, board.H, comp.cssW, comp.cssH);
        comp.renderAll();
      }
    });
    this.resizeObs.observe(this.host);
    this.index = -1;
  }

  play(): void {
    if (this.playing || this.destroyed || !this.board) return;
    if (this.index >= this.total - 1) {
      void this.seek(-1).then(() => this.play());
      return;
    }
    this.playing = true;
    const run = ++this.run;
    void this.loop(run);
  }

  pause(): void {
    this.playing = false;
    this.run++;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, speed);
  }

  async seek(index: number): Promise<void> {
    this.pause();
    const target = Math.max(-1, Math.min(this.total - 1, Math.round(index)));
    if (target < this.index) await this.reset();
    while (this.index < target && this.painter) {
      this.index++;
      await applyOp(this.painter, this.ops[this.index + 1]);
    }
    this.comp?.reload();
    this.em.emit('progress', this.progress());
  }

  private async loop(run: number): Promise<void> {
    while (this.run === run && this.index < this.total - 1 && !this.destroyed) {
      const op = this.ops[this.index + 2];
      if (op.op === 'stroke') await this.animateStroke(op, run);
      else if (this.painter) await applyOp(this.painter, op);
      if (this.run !== run) return;
      this.index++;
      this.em.emit('progress', this.progress());
      await wait(Math.max(8, 60 / this.speed));
    }
    if (this.run === run) {
      this.playing = false;
      this.em.emit('end', undefined);
    }
  }

  private async animateStroke(op: LogStroke, run: number): Promise<void> {
    const { board, painter, comp, preview } = this;
    if (!board || !painter || !comp || !preview || !board.layer(op.layer) || !op.dts.length) return;
    await board.ensureFrame(op.frame);
    if (comp.frame !== op.frame) comp.setFrame(op.frame);
    if (comp.active !== op.layer) comp.setActive(op.layer);
    const times = sampleTimes(op.dts);
    const n = op.dts.length;
    const duration = times[n - 1] || 1;
    const k = Math.max(this.speed, duration / (this.o.maxStrokeMs ?? 1500));
    const s = painter.begin(specOfLog(op), op.xyp[0], op.xyp[1], op.xyp[2], times[0]);
    let i = 1;
    const t0 = performance.now();
    while (i < n) {
      await frame();
      if (this.run !== run) {
        const r = s.cancel();
        comp.layerChanged(op.layer, r);
        comp.invalidateDoc(r);
        return;
      }
      const due = (performance.now() - t0) * k;
      while (i < n && times[i] <= due) {
        if (op.snap === i) s.snap();
        s.add(op.xyp[i * 3], op.xyp[i * 3 + 1], op.xyp[i * 3 + 2], times[i]);
        i++;
      }
      const r = s.update();
      if (r.x1 > r.x0) {
        s.preview(preview.buf, r);
        comp.showPreview(op.layer, preview.img, r);
        comp.invalidateDoc(r);
        comp.flush();
      }
    }
    if (op.snap === n) s.snap();
    s.commit();
    comp.flush();
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
    this.resizeObs?.disconnect();
    this.comp?.destroy();
    this.em.clear();
  }
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Plays how a drawing was made (its stroke log), an ArtScript, or a raw log, in `host`. */
export function playTimelapse(host: HTMLElement, source: ArtDoc | ArtScript | readonly LogOp[], o: TimelapseOptions = {}): Timelapse {
  return new Player(host, source, o);
}
