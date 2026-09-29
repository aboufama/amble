/**
 * The Trail's landscape (§2.4), in daylight: a light sky with a few flat clouds, soft rolling hills that
 * drift at 0.3x and 0.55x while the trail scrolls, and the grass with its sandy path and footprints. The
 * First page borrows the sky and the path along the bottom (§2.3). Flat shapes only: no glows, no
 * texture, no runtime filters. The colours are tokens, mixed in landscape.css; High contrast draws the
 * same shapes as white lines on black.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { cx } from '../../ui/cx';
import { DESIGN_H, groundTop, pathTop, pathWidth, smoothPath } from '../../home/trailData';
import './landscape.css';

/** A flat cloud: a rounded base with three puffs on it, centred on (x, y). */
function Cloud({ x, y, w }: { x: number; y: number; w: number }) {
  const h = w * 0.2;
  return (
    <g className="cloud" transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
      <circle cx={-w * 0.2} cy={-h * 0.45} r={w * 0.17} />
      <circle cx={w * 0.06} cy={-h * 0.8} r={w * 0.23} />
      <circle cx={w * 0.29} cy={-h * 0.35} r={w * 0.14} />
    </g>
  );
}

/** The daylight sky behind everything, with a few clouds on the right, clear of the hero copy. */
export function DaySky({ clouds = true, className }: { clouds?: boolean; className?: string }) {
  return (
    <div className={cx('day-sky', className)} aria-hidden="true">
      {clouds && (
        <svg className="day-sky__clouds" width="1366" height="360" viewBox="0 0 1366 360" focusable="false">
          <Cloud x={1098} y={118} w={190} />
          <Cloud x={868} y={78} w={118} />
          <Cloud x={1282} y={214} w={126} />
          <Cloud x={960} y={262} w={92} />
        </svg>
      )}
    </div>
  );
}

function wave(x: number, base: number, a: number, p: number, b: number, q: number, phase: number): number {
  return base + a * Math.sin(x / p + phase) + b * Math.sin(x / q + phase * 2.3);
}

function ridge(width: number, y: (x: number) => number): string {
  return smoothPath(Array.from({ length: Math.floor(width / 60) + 1 }, (_, i) => [i * 60, y(i * 60)] as [number, number]));
}

const HILLS_W = 3600;
const farY = (x: number) => wave(x, 508, 20, 230, 11, 97, 0.4);
const midY = (x: number) => wave(x, 594, 14, 180, 8, 77, 1.1);

/**
 * Far and middle hills, bottom-anchored. `scroller` is the trail's scroll container: the far hills move
 * at 0.3x and the middle ones at 0.55x of its scroll (none under reduced motion or a paused trail).
 */
export function ParallaxHills({ scroller, still }: { scroller: RefObject<HTMLElement | null>; still: boolean }) {
  const far = useRef<HTMLDivElement>(null);
  const mid = useRef<HTMLDivElement>(null);
  const shapes = useMemo(() => {
    const farRidge = ridge(HILLS_W, farY);
    const midRidge = ridge(HILLS_W, midY);
    const close = `L${HILLS_W} ${DESIGN_H}L0 ${DESIGN_H}Z`;
    return { farRidge, farD: farRidge + close, midRidge, midD: midRidge + close };
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
        <svg width={HILLS_W} height={DESIGN_H} viewBox={`0 0 ${HILLS_W} ${DESIGN_H}`} focusable="false">
          <path className="hills__far" d={shapes.farD} />
          <path className="hills__ridge" d={shapes.farRidge} />
        </svg>
      </div>
      <div ref={mid} className="hills__layer">
        <svg width={HILLS_W} height={DESIGN_H} viewBox={`0 0 ${HILLS_W} ${DESIGN_H}`} focusable="false">
          <path className="hills__mid" d={shapes.midD} />
          <path className="hills__ridge" d={shapes.midRidge} />
        </svg>
      </div>
    </div>
  );
}

/** A soft flat shadow on the path (under the lamppost's character). */
export interface Shadow {
  cx: number;
}

/** The grass the signs stand on, the sandy path and its footprints. */
export function TrailGround({ width, shadows = [] }: { width: number; shadows?: Shadow[] }) {
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
    const band = `${smoothPath(top)}L${bottom[bottom.length - 1][0]} ${bottom[bottom.length - 1][1]}${smoothPath([...bottom].reverse()).replace(/^M[^C]*/, '')}Z`;
    const groundEdge = smoothPath(ground);
    const groundD = `${groundEdge}L${width + step} ${DESIGN_H}L-40 ${DESIGN_H}Z`;
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
    return { lower, band, groundD, groundEdge, top: smoothPath(top), steps };
  }, [width]);

  return (
    <svg className="trail-ground" width={width} height={DESIGN_H} viewBox={`0 0 ${width} ${DESIGN_H}`} aria-hidden="true" focusable="false">
      <path className="trail-ground__grass" d={shapes.groundD} />
      <path className="trail-ground__grass-edge" d={shapes.groundEdge} />
      <path className="trail-ground__path" d={shapes.band} />
      <path className="trail-ground__edge" d={shapes.top} />
      <path className="trail-ground__edge" d={shapes.lower} />
      <g className="trail-ground__steps">
        {shapes.steps.map(([x, y, r], i) => (
          <ellipse key={i} cx={x} cy={y} rx="5.5" ry="2.8" transform={`rotate(${r} ${x} ${y})`} />
        ))}
      </g>
      {shadows.map((s, i) => (
        <ellipse key={i} className="trail-ground__shadow" cx={s.cx} cy={pathTop(s.cx) + 16} rx="46" ry="8" />
      ))}
    </svg>
  );
}

/**
 * The First page's ground (§2.3): a strip of the Trail along the bottom, grass with the sandy path
 * across it.
 */
export function BottomPath() {
  const shapes = useMemo(() => {
    const top = (x: number) => 738 - (x + 30) * (34 / 1430);
    const pts: Array<[number, number]> = [];
    const low: Array<[number, number]> = [];
    const grass: Array<[number, number]> = [];
    for (let x = -30; x <= 1400; x += 50) {
      pts.push([x, top(x)]);
      low.push([x, top(x) + 26 - (x + 30) * (6 / 1430)]);
      grass.push([x, top(x) - 22 - 10 * Math.sin(x / 210)]);
    }
    const band = `${smoothPath(pts)}L1400 ${low[low.length - 1][1]}${smoothPath([...low].reverse()).replace(/^M[^C]*/, '')}Z`;
    const grassEdge = smoothPath(grass);
    return { band, edge: smoothPath(pts), low: smoothPath(low), grassEdge, grassD: `${grassEdge}L1400 768L-30 768Z` };
  }, []);
  return (
    <svg className="bottom-path" viewBox="0 640 1366 128" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path className="trail-ground__grass" d={shapes.grassD} />
      <path className="trail-ground__grass-edge" d={shapes.grassEdge} />
      <path className="trail-ground__path" d={shapes.band} />
      <path className="trail-ground__edge" d={shapes.edge} />
      <path className="trail-ground__edge" d={shapes.low} />
    </svg>
  );
}
