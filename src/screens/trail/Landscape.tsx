/**
 * The Night Trail's landscape (§2.4): the sky (a static SVG: stars, the moon, a waiting constellation),
 * the hills that drift at 0.3x while the trail scrolls, and the scrolling ground with its lit path, light
 * pools, footprints and fireflies. The First page borrows the sky and the path along the bottom (§2.3).
 * No runtime filters: glows are layered shapes; the grain is the baked tile (`.grain`).
 */
import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { cx } from '../../ui/cx';
import { DESIGN_H, groundTop, pathTop, pathWidth, smoothPath } from '../../home/trailData';
import skyUrl from './landscape.svg';
import './landscape.css';

/** The night sky behind everything: gradient, grain and (optionally) the stars, moon and constellation. */
export function NightSky({ decor = true, className }: { decor?: boolean; className?: string }) {
  return (
    <div className={cx('night-sky', 'grain', className)} aria-hidden="true">
      {decor && <div className="night-sky__decor" style={{ backgroundImage: `url(${JSON.stringify(skyUrl)})` } as CSSProperties} />}
    </div>
  );
}

function wave(x: number, base: number, a: number, p: number, b: number, q: number, phase: number): number {
  return base + a * Math.sin(x / p + phase) + b * Math.sin(x / q + phase * 2.3);
}

function hillPath(width: number, y: (x: number) => number): string {
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= width; x += 60) pts.push([x, y(x)]);
  return `${smoothPath(pts)}L${width} ${DESIGN_H}L0 ${DESIGN_H}Z`;
}

const HILLS_W = 3600;

/**
 * Far and middle hills, bottom-anchored. `scroller` is the trail's scroll container: the far hills move
 * at 0.3x and the middle ones at 0.55x of its scroll (none under reduced motion or a paused trail).
 */
export function ParallaxHills({ scroller, still }: { scroller: RefObject<HTMLElement | null>; still: boolean }) {
  const far = useRef<HTMLDivElement>(null);
  const mid = useRef<HTMLDivElement>(null);
  const farD = useMemo(() => hillPath(HILLS_W, (x) => wave(x, 508, 20, 230, 11, 97, 0.4)), []);
  const farRidge = useMemo(() => smoothPath(Array.from({ length: HILLS_W / 60 + 1 }, (_, i) => [i * 60, wave(i * 60, 508, 20, 230, 11, 97, 0.4)] as [number, number])), []);
  const midD = useMemo(() => hillPath(HILLS_W, (x) => wave(x, 594, 14, 180, 8, 77, 1.1)), []);
  const midRidge = useMemo(() => smoothPath(Array.from({ length: HILLS_W / 60 + 1 }, (_, i) => [i * 60, wave(i * 60, 594, 14, 180, 8, 77, 1.1)] as [number, number])), []);
  const lights = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    for (let x = 180; x < HILLS_W; x += 470) {
      for (let k = 0; k < 3; k++) {
        const lx = x + k * 13 + (k === 1 ? 2 : 0);
        out.push([lx, wave(lx, 508, 20, 230, 11, 97, 0.4) + 8 + (k % 2) * 4, k === 1 ? 1.3 : 1.7]);
      }
    }
    return out;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const x = still ? 0 : el.scrollLeft;
      if (far.current) far.current.style.transform = `translate3d(${-x * 0.3}px,0,0)`;
      if (mid.current) mid.current.style.transform = `translate3d(${-x * 0.55}px,0,0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scroller, still]);

  return (
    <div className="hills" aria-hidden="true">
      <div ref={far} className="hills__layer">
        <svg width={HILLS_W} height={DESIGN_H} viewBox={`0 0 ${HILLS_W} ${DESIGN_H}`}>
          <path className="hills__far" d={farD} />
          <path className="hills__far-ridge" d={farRidge} />
          <g className="hills__lights">
            {lights.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} />
            ))}
          </g>
        </svg>
      </div>
      <div ref={mid} className="hills__layer">
        <svg width={HILLS_W} height={DESIGN_H} viewBox={`0 0 ${HILLS_W} ${DESIGN_H}`}>
          <path className="hills__mid" d={midD} />
          <path className="hills__mid-ridge" d={midRidge} />
        </svg>
      </div>
    </div>
  );
}

export interface Pool {
  cx: number;
  /** The lamppost's pool is bigger and brighter. */
  big?: boolean;
}

/** The ground the signs stand on, the lit path, pools of light under each stop, footprints (the fireflies over it are `Fireflies`). */
export function TrailGround({ width, pools }: { width: number; pools: Pool[] }) {
  const shapes = useMemo(() => {
    const step = 40;
    const top: Array<[number, number]> = [];
    const bottom: Array<[number, number]> = [];
    const ground: Array<[number, number]> = [];
    for (let x = -40; x <= width + step; x += step) {
      top.push([x, pathTop(x)]);
      bottom.push([x, pathTop(x) + pathWidth(x)]);
      ground.push([x, groundTop(x)]);
    }
    const lower = smoothPath(bottom);
    const bandFill = `${smoothPath(top)}L${bottom[bottom.length - 1][0]} ${bottom[bottom.length - 1][1]}${smoothPath([...bottom].reverse()).replace(/^M[^C]*/, '')}Z`;
    const groundD = `${smoothPath(ground)}L${width + step} ${DESIGN_H}L-40 ${DESIGN_H}Z`;
    const steps: Array<[number, number, number]> = [];
    for (let x = 96; x < width; x += 232) {
      for (const [dx, dy] of [
        [0, 8],
        [24, 0],
      ] as const) {
        const fx = x + dx;
        steps.push([fx, pathTop(fx) + 12 + dy, -6 + (fx % 5)]);
      }
    }
    return { lower, bandFill, groundD, top: smoothPath(top), steps };
  }, [width]);

  return (
    <svg className="trail-ground" width={width} height={DESIGN_H} viewBox={`0 0 ${width} ${DESIGN_H}`} aria-hidden="true">
      <defs>
        <radialGradient id="tg-pool" cx="50%" cy="50%" r="50%">
          <stop offset="0" className="tg-pool-a" />
          <stop offset="1" className="tg-pool-b" />
        </radialGradient>
        <radialGradient id="tg-pool-big" cx="50%" cy="50%" r="50%">
          <stop offset="0" className="tg-poolbig-a" />
          <stop offset="0.5" className="tg-poolbig-m" />
          <stop offset="1" className="tg-poolbig-b" />
        </radialGradient>
        <linearGradient id="tg-trail" x1="0" x2="1">
          <stop offset="0" className="tg-trail-a" />
          <stop offset="0.5" className="tg-trail-b" />
          <stop offset="1" className="tg-trail-c" />
        </linearGradient>
      </defs>
      <path className="trail-ground__ground" d={shapes.groundD} />
      <path className="trail-ground__glow-wide" d={shapes.bandFill} />
      <path className="trail-ground__glow" d={shapes.bandFill} />
      <path className="trail-ground__band" d={shapes.bandFill} fill="url(#tg-trail)" />
      <path className="trail-ground__edge" d={shapes.top} />
      <path className="trail-ground__edge trail-ground__edge--low" d={shapes.lower} />
      <g className="trail-ground__steps">
        {shapes.steps.map(([x, y, r], i) => (
          <ellipse key={i} cx={x} cy={y} rx="5.5" ry="2.8" transform={`rotate(${r} ${x} ${y})`} />
        ))}
      </g>
      {pools.map((p, i) => {
        const y = pathTop(p.cx) + 16;
        return p.big ? (
          <g key={i}>
            <ellipse cx={p.cx} cy={y} rx="160" ry="44" fill="url(#tg-pool-big)" />
            <ellipse className="trail-ground__shadow" cx={p.cx} cy={y} rx="46" ry="9" />
          </g>
        ) : (
          <ellipse key={i} cx={p.cx} cy={y} rx="120" ry="30" fill="url(#tg-pool)" />
        );
      })}
    </svg>
  );
}

/** A firefly's box: its 6 px glow and a pixel to spare for the edge's antialiasing. */
const FLY_BOX = 14;

/**
 * The fireflies over the ground, each a box of its own rather than part of the ground's picture: the glow
 * pulses on the compositor, so the ground is never repainted while the Trail waits (§3.6).
 */
export function Fireflies({ width }: { width: number }) {
  const flies = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let x = 250, i = 0; x < width; x += 310, i++) out.push([x + (i % 3) * 37, pathTop(x) - 60 - (i % 4) * 22]);
    return out;
  }, [width]);
  return (
    <div className="trail-flies motion-loop" aria-hidden="true">
      {flies.map(([x, y], i) => (
        <span key={i} className="trail-fly" style={{ left: x - FLY_BOX / 2, top: `calc(100% - ${DESIGN_H - y + FLY_BOX / 2}px)`, animationDelay: `${(i % 5) * -0.9}s` } as CSSProperties}>
          <svg width={FLY_BOX} height={FLY_BOX} viewBox={`${-FLY_BOX / 2} ${-FLY_BOX / 2} ${FLY_BOX} ${FLY_BOX}`}>
            <circle className="trail-fly__glow" r="6" />
            <circle className="trail-fly__dot" r="1.8" />
          </svg>
        </span>
      ))}
    </div>
  );
}

/** A hanging sign lantern (the bracket on each world sign, and the lamppost's). `lit` fades it on. */
export function BracketLantern({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={cx('bracket', className)} style={style} width="30" height="36" viewBox="0 0 30 36" aria-hidden="true">
      <circle className="bracket__glow" cx="20" cy="15" r="16" />
      <path className="bracket__arm" d="M2 36 V6 Q2 2 6 2 H20" />
      <path className="bracket__arm" d="M20 2v4" />
      <rect className="bracket__lantern" x="13" y="6" width="14" height="18" rx="5" />
      <rect className="bracket__light" x="16" y="9" width="8" height="11" rx="3" />
    </svg>
  );
}

const BOTTOM_LANTERNS = [58, 208, 372, 560, 760, 968, 1150, 1316];

/**
 * The First page's ground (§2.3): the trail's lit path along the bottom 90 px, with its lanterns lighting
 * one by one, left to right, when the page opens (`lit`).
 */
export function BottomPath({ lit }: { lit: boolean }) {
  const top = (x: number) => 738 - (x + 30) * (34 / 1430);
  const band = useMemo(() => {
    const pts: Array<[number, number]> = [];
    const low: Array<[number, number]> = [];
    for (let x = -30; x <= 1400; x += 50) {
      pts.push([x, top(x)]);
      low.push([x, top(x) + 26 - (x + 30) * (6 / 1430)]);
    }
    const fill = `${smoothPath(pts)}L1400 ${low[low.length - 1][1]}${smoothPath([...low].reverse()).replace(/^M[^C]*/, '')}Z`;
    return { fill, edge: smoothPath(pts), low: smoothPath(low) };
  }, []);
  return (
    <svg className={cx('bottom-path', lit && 'bottom-path--lit')} viewBox="0 658 1366 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="bp-trail" x1="0" x2="1">
          <stop offset="0" className="tg-trail-a" />
          <stop offset="0.5" className="tg-trail-b" />
          <stop offset="1" className="tg-trail-c" />
        </linearGradient>
      </defs>
      <path className="trail-ground__glow-wide" d={band.fill} />
      <path className="trail-ground__glow" d={band.fill} />
      <path className="trail-ground__band" d={band.fill} fill="url(#bp-trail)" />
      <path className="trail-ground__edge" d={band.edge} />
      <path className="trail-ground__edge trail-ground__edge--low" d={band.low} />
      {BOTTOM_LANTERNS.map((x, i) => {
        const y = top(x) - 1;
        return (
          <g key={x} className="bottom-path__lantern" style={{ ['--i' as string]: i } as CSSProperties}>
            <path className="bottom-path__post" d={`M${x} ${y} V${y - 16}`} />
            <circle className="bottom-path__glow" cx={x} cy={y - 22} r="13" />
            <rect className="bracket__lantern" x={x - 5} y={y - 29} width="10" height="12" rx="3.5" />
            <rect className="bracket__light" x={x - 2.8} y={y - 26.8} width="5.6" height="7.4" rx="2" />
          </g>
        );
      })}
    </svg>
  );
}
