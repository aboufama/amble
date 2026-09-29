/**
 * The doodle, alive (§2.3, §3.6): the rig preview takes the drawing's place on the paper at exactly the
 * spot and size it was drawn (the **wake**: a 4 % lift and a shadow, three squash-bounces, then a drop to
 * the pencil ground line). Tapping the paper makes it hop there (arc 0.22 x its height, squash on
 * landing, a soft boing). Arrow keys hop it left and right; Space or Enter hops in place.
 * Reduced motion: a crossfade, and one bounce per tap.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createRigPreview, type RigData, type RigPreview } from '../../cores/rig';
import { t } from '../../i18n';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';

/** Where the drawing stood on the paper, in CSS px of the stage box. */
export interface AliveGeometry {
  /** The stage box (the drawing surface's box). */
  boxW: number;
  boxH: number;
  /** Feet (the export anchor). */
  feetX: number;
  feetY: number;
  /** From the feet to the top of the drawing. */
  height: number;
  /** How far the drawing reaches left and right of its feet. */
  left: number;
  right: number;
  /** The pencil ground line, as a fraction of the box height. */
  line: number;
}

export interface AliveStageHandle {
  /** New bones for the same drawing (a kind change): rebinds in place. */
  rerig(rig: RigData): Promise<void>;
  /** Hop to a stage x (CSS px). */
  hop(x: number): void;
  /** Where the creature stands now, in page px (the start of its flight into a world). */
  box(): DOMRect | null;
}

export interface AliveStageProps {
  flat: Blob;
  rig: RigData;
  geo: AliveGeometry;
  name: string;
  reduced: boolean;
  /** The preview is on screen at the drawing's place: hide the drawn pixels now. */
  onShown(): void;
  /** The wake is over (It's alive! and the chips may follow). */
  onAwake(): void;
}

/** Arc height of a tap-hop, in drawing heights (§2.3). */
const HOP_ARC = 0.22;
/** Flight time of a hop with that arc under the preview's gravity (5.5 heights/s²). */
const HOP_MS = Math.round(((2 * Math.sqrt(2 * 5.5 * HOP_ARC)) / 5.5) * 1000);
const LIFT = 1.04;

export const AliveStage = forwardRef<AliveStageHandle, AliveStageProps>(function AliveStage({ flat, rig, geo, name, reduced, onShown, onAwake }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<RigPreview | null>(null);
  const [shown, setShown] = useState(false);
  const [shadow, setShadow] = useState<{ x: number; y: number; from: number; hop: number; on: boolean }>({ x: geo.feetX, y: geo.feetY, from: geo.feetX, hop: 0, on: false });
  const state = useRef({ x: geo.feetX, groundY: geo.feetY, height: geo.height, busyUntil: 0, dpr: 1 });
  const callbacks = useRef({ onShown, onAwake });
  callbacks.current = { onShown, onAwake };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(geo.boxW * dpr);
    el.height = Math.round(geo.boxH * dpr);
    const line = geo.line * geo.boxH;
    const ground = reduced ? Math.max(geo.feetY, line) : geo.feetY;
    state.current = { x: geo.feetX, groundY: ground, height: geo.height, busyUntil: 0, dpr };
    const p = createRigPreview(el, { height: geo.height * dpr, ground: ground / geo.boxH, start: geo.feetX / geo.boxW, autoplay: !reduced });
    preview.current = p;
    const timers: number[] = [];
    let live = true;
    void p.load(flat, rig).then(() => {
      if (!live) return;
      setShown(true);
      callbacks.current.onShown();
      if (reduced) {
        setShadow({ x: geo.feetX, y: ground, from: geo.feetX, hop: 0, on: true });
        timers.push(window.setTimeout(() => callbacks.current.onAwake(), 160));
        return;
      }
      // The lift: 4 % bigger, grown around the feet over 220 ms.
      const t0 = performance.now();
      const grow = (now: number) => {
        if (!live) return;
        const k = Math.min(1, (now - t0) / 220);
        const eased = 1 - Math.pow(1 - k, 3);
        p.setOptions({ height: geo.height * dpr * (1 + (LIFT - 1) * eased) });
        if (k < 1) requestAnimationFrame(grow);
      };
      requestAnimationFrame(grow);
      state.current.height = geo.height * LIFT;
      setShadow({ x: geo.feetX, y: geo.feetY, from: geo.feetX, hop: 0, on: true });
      // Three squash-bounces (the rig's land move); "It's alive!" arrives during them; then the drop to
      // the pencil line.
      [200, 460, 720].forEach((at) => timers.push(window.setTimeout(() => live && p.play('land'), at)));
      timers.push(window.setTimeout(() => live && callbacks.current.onAwake(), 560));
      timers.push(
        window.setTimeout(() => {
          if (!live || line <= geo.feetY + 2) return;
          p.setOptions({ ground: line / geo.boxH });
          p.input({});
          state.current.groundY = line;
          setShadow({ x: state.current.x, y: line, from: state.current.x, hop: 0, on: true });
        }, 980),
      );
    });
    return () => {
      live = false;
      timers.forEach((id) => clearTimeout(id));
      p.destroy();
      preview.current = null;
    };
    // The stage is made once per drawing; later changes (new bones) go through the handle.
  }, [flat]);

  const hopTo = (x: number) => {
    const p = preview.current;
    const s = state.current;
    if (!p || !shown) return;
    const now = performance.now();
    if (now < s.busyUntil) return;
    const h = s.height;
    const minX = Math.min(geo.boxW / 2, geo.left * (h / geo.height) + 4);
    const maxX = Math.max(geo.boxW / 2, geo.boxW - geo.right * (h / geo.height) - 4);
    const tx = Math.max(minX, Math.min(maxX, x));
    s.busyUntil = now + HOP_MS + 60;
    p.hop(tx * s.dpr, (s.groundY - HOP_ARC * h) * s.dpr);
    playUiSound('boing');
    const from = s.x;
    const groundY = s.groundY;
    setShadow((sh) => ({ x: tx, y: groundY, from, hop: sh.hop + 1, on: true }));
    s.x = tx;
    if (reduced) window.setTimeout(() => preview.current?.pause(), HOP_MS + 400);
  };

  useImperativeHandle(ref, () => ({
    async rerig(next: RigData) {
      await preview.current?.load(flat, next);
    },
    hop: hopTo,
    box() {
      const el = canvas.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const st = state.current;
      const k = st.height / geo.height;
      const left = geo.left * k;
      const right = geo.right * k;
      return new DOMRect(r.left + st.x - left, r.top + st.groundY - st.height, left + right, st.height);
    },
  }));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    hopTo(e.clientX - r.left);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = geo.boxW / 5;
    const s = state.current;
    if (e.key === 'ArrowLeft') hopTo(s.x - step);
    else if (e.key === 'ArrowRight') hopTo(s.x + step);
    else if (e.key === ' ' || e.key === 'Enter') hopTo(s.x);
    else return;
    e.preventDefault();
  };

  const shadowW = Math.max(40, (geo.left + geo.right) * 0.8);
  return (
    <div
      className={cx('alive-stage', shown && 'alive-stage--shown', reduced && 'alive-stage--still')}
      role="button"
      tabIndex={0}
      aria-label={t('home.paperAliveLabel', { name })}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-testid="alive-stage"
    >
      <span
        key={shadow.hop}
        className={cx('alive-stage__shadow', shadow.on && 'alive-stage__shadow--on', shadow.hop > 0 && !reduced && 'alive-stage__shadow--hop')}
        style={{ left: shadow.x - shadowW / 2, top: shadow.y - 7, width: shadowW, ['--hop-ms' as string]: `${HOP_MS}ms`, ['--dx' as string]: `${shadow.from - shadow.x}px` } as CSSProperties}
        aria-hidden="true"
      />
      <canvas ref={canvas} className="alive-stage__canvas" data-testid="alive-canvas" />
    </div>
  );
});
