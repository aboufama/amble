/**
 * The bones (§2.11), flat on the white sheet in the bones' green (`--bones`): tapered bones with stripes
 * on the screen-left side and dots on the screen-right side, plain for the middle, so colour is never the
 * only cue, each on a thin white casing so it stands clear of the drawing's colours. Wiggly bits are
 * dashed; the ground anchor is a line under the feet; the bone whose card is open wears the selection
 * purple and halo. Each bone has a wide, invisible stroke to grab: drag its middle to move the whole
 * bone, tap it for its card.
 */
import { useId, type PointerEvent } from 'react';
import { sideOf, type Point, type RigData, type Side } from '../../cores/rig';
import { toSky, type Fit } from '../../bones/geometry';
import { cx } from '../../ui/cx';

export interface BoneLinesProps {
  rig: RigData;
  fit: Fit;
  w: number;
  h: number;
  /** Faded while Amble looks for bones. */
  dim: boolean;
  /** The bone whose card is open. */
  selectedBone: number | null;
  /** A wiggly bit being dragged out, sky px. */
  wigglyLine: [Point, Point] | null;
  onBoneDown(index: number, e: PointerEvent<SVGLineElement>): void;
  onBoneMove(e: PointerEvent<SVGLineElement>): void;
  onBoneUp(e: PointerEvent<SVGLineElement>): void;
  onBoneCancel(e: PointerEvent<SVGLineElement>): void;
}

interface Seg {
  i: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  side: Side;
  wiggly: boolean;
  held: boolean;
}

/** A spindle from (x1, y1) to (x2, y2), widest a fifth of the way along (like a drawn bone). */
function spindle(s: Seg, maxHalf: number): string {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  if (len < 1) return '';
  const ux = (s.x2 - s.x1) / len, uy = (s.y2 - s.y1) / len;
  const half = Math.min(maxHalf, Math.max(2.2, len * 0.11));
  const mx = s.x1 + ux * len * 0.22, my = s.y1 + uy * len * 0.22;
  const f = (v: number) => v.toFixed(1);
  return `M${f(s.x1)} ${f(s.y1)}L${f(mx - uy * half)} ${f(my + ux * half)}L${f(s.x2)} ${f(s.y2)}L${f(mx + uy * half)} ${f(my - ux * half)}Z`;
}

/** Where a bone that starts away from its parent hangs on it: the nearest point of the parent. */
function attachPoint(p: Seg, x: number, y: number): Point {
  const vx = p.x2 - p.x1, vy = p.y2 - p.y1;
  const l2 = vx * vx + vy * vy || 1;
  const u = Math.max(0, Math.min(1, ((x - p.x1) * vx + (y - p.y1) * vy) / l2));
  return [p.x1 + u * vx, p.y1 + u * vy];
}

export function BoneLines({ rig, fit, w, h, dim, selectedBone, wigglyLine, onBoneDown, onBoneMove, onBoneUp, onBoneCancel }: BoneLinesProps) {
  const uid = useId().replace(/:/g, '');
  const stripes = `bones-stripes-${uid}`;
  const dots = `bones-dots-${uid}`;
  const segs: Seg[] = rig.bones.map((b, i) => {
    const [x1, y1] = toSky(fit, b.x, b.y);
    const [x2, y2] = toSky(fit, b.x2, b.y2);
    return { i, x1, y1, x2, y2, side: sideOf(rig, i), wiggly: !!b.dynamic, held: !!b.rigid };
  });
  // the middle last, so it reads over the limbs that start on it
  const order = [...segs].sort((a, b) => (a.side === 'C' ? 1 : 0) - (b.side === 'C' ? 1 : 0));
  const links: Array<{ key: number; from: Point; to: Point }> = [];
  rig.bones.forEach((b, i) => {
    if (b.parent < 0) return;
    const p = rig.bones[b.parent];
    const joined = Math.hypot(b.x - p.x2, b.y - p.y2) < 1 || Math.hypot(b.x - p.x, b.y - p.y) < 1;
    if (joined) return;
    const s = segs[i];
    links.push({ key: i, from: attachPoint(segs[b.parent], s.x1, s.y1), to: [s.x1, s.y1] });
  });
  const [ax, ay] = toSky(fit, rig.anchor[0], rig.anchor[1]);
  const groundHalf = Math.max(22, Math.min(64, fit.w * fit.k * 0.16));
  const maxHalf = Math.max(3.5, Math.min(6, fit.k * 5));

  return (
    <svg className={cx('bone-lines', dim && 'bone-lines--dim')} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={stripes} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="bone-pat bone-pat--L" width="5" height="5" />
          <rect className="bone-pat__mark" width="1.8" height="5" />
        </pattern>
        <pattern id={dots} width="5.5" height="5.5" patternUnits="userSpaceOnUse">
          <rect className="bone-pat bone-pat--R" width="5.5" height="5.5" />
          <circle className="bone-pat__mark" cx="2.75" cy="2.75" r="1.25" />
        </pattern>
      </defs>
      <line className="bone-ground" x1={ax - groundHalf} y1={ay} x2={ax + groundHalf} y2={ay} />
      {/* the open card's bone: Scratch's selection halo, flat, under the bones */}
      {selectedBone !== null && segs[selectedBone] && (
        <line className="bone-halo" x1={segs[selectedBone].x1} y1={segs[selectedBone].y1} x2={segs[selectedBone].x2} y2={segs[selectedBone].y2} />
      )}
      {/* a white casing under the plain and wiggly bones (the tapered ones are outlined in white themselves) */}
      <g className="bone-case">
        {order
          .filter((s) => s.wiggly || s.side === 'C')
          .map((s) => (
            <line key={s.i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          ))}
      </g>
      <g className="bone-links">
        {links.map((l) => (
          <line key={l.key} x1={l.from[0]} y1={l.from[1]} x2={l.to[0]} y2={l.to[1]} />
        ))}
      </g>
      <g className="bone-bodies">
        {order.map((s) => {
          const on = selectedBone === s.i && 'bone--on';
          if (s.wiggly) {
            return <line key={s.i} className={cx('bone-wiggly', on)} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
          }
          if (s.side === 'C') {
            return <line key={s.i} className={cx('bone-mid', s.held && 'bone--held', on)} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
          }
          return <path key={s.i} className={cx('bone-side', s.held && 'bone--held', on)} d={spindle(s, maxHalf)} fill={`url(#${s.side === 'L' ? stripes : dots})`} />;
        })}
      </g>
      {wigglyLine && <line className="bone-new-wiggly" x1={wigglyLine[0][0]} y1={wigglyLine[0][1]} x2={wigglyLine[1][0]} y2={wigglyLine[1][1]} />}
      <g className="bone-hits">
        {segs.map((s) => (
          <line
            key={s.i}
            data-bone={rig.bones[s.i].name}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            onPointerDown={(e) => onBoneDown(s.i, e)}
            onPointerMove={onBoneMove}
            onPointerUp={onBoneUp}
            onPointerCancel={onBoneCancel}
          />
        ))}
      </g>
    </svg>
  );
}
