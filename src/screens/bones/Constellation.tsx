/**
 * The sky (§2.11): the drawing at 92 % with its sticker edge, the constellation over it, the ground
 * anchor, Amble's guess, the key hints and the legend. It is a `role="application"` region: Tab goes
 * from star to star, arrows nudge, Enter picks up and drops. A hidden bone list mirrors the bone tree
 * for screen readers (and shows itself when it has focus).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { drawRigged, moveBone, type BoundRig, type Point } from '../../cores/rig';
import type { BonesController, BonesView } from '../../bones/bonesController';
import { bodyCentre, boneHeight } from '../../bones/edits';
import { fitArt, toArt, type Fit } from '../../bones/geometry';
import { boneName, guessReasons, starsOf, type Star } from '../../bones/words';
import { t } from '../../i18n';
import { announce, showToast } from '../../state/app';
import { Keycap } from '../../ui/components';
import { useReducedMotion } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';
import { BoneCard } from './BoneCard';
import { BoneLines } from './BoneLines';
import { BoneTree } from './BoneTree';
import { GuessNote } from './GuessNote';
import { JointLayer } from './JointLayer';

export interface ConstellationProps {
  ctl: BonesController;
  view: BonesView;
  wiggly: boolean;
  onWigglyDone(): void;
  pieces: boolean;
}

function useSize(ref: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The Tab order of the stars: reading order (top to bottom, then left to right) when the set of stars
 * changes, and then kept while they move, so a star never jumps in the order (or loses focus) mid-drag.
 */
function useStableOrder(stars: Star[]): Star[] {
  const order = useRef<string[]>([]);
  const ids = stars.map((s) => s.sid).sort().join('|');
  const known = useRef('');
  if (ids !== known.current) {
    known.current = ids;
    const rowH = 18;
    order.current = [...stars]
      .sort((a, b) => Math.round(a.joint.y / rowH) - Math.round(b.joint.y / rowH) || a.joint.x - b.joint.x)
      .map((s) => s.sid);
  }
  const bySid = new Map(stars.map((s) => [s.sid, s]));
  return order.current.map((sid) => bySid.get(sid)).filter((s): s is Star => !!s);
}

/** A few faint background stars (fixed, so the sky never flickers between renders). */
const SKY_STARS: Array<[number, number, number]> = [
  [0.07, 0.13, 1.2], [0.15, 0.66, 1], [0.24, 0.22, 1.3], [0.86, 0.14, 1.1], [0.93, 0.47, 1.3], [0.79, 0.82, 1],
  [0.1, 0.89, 1.1], [0.74, 0.1, 1], [0.9, 0.76, 1], [0.05, 0.47, 1], [0.33, 0.9, 1.1], [0.58, 0.06, 1.2],
  [0.66, 0.93, 1], [0.97, 0.3, 1.1], [0.42, 0.14, 0.9], [0.2, 0.4, 0.9],
];

function PiecesCanvas({ bound, fit, w, h }: { bound: BoundRig; fit: Fit; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [ax, ay] = bound.rig.anchor;
    drawRigged(ctx, bound, null, { x: fit.ox + ax * fit.k, y: fit.oy + ay * fit.k, scale: fit.k, pieces: true });
  }, [bound, fit, w, h]);
  return <canvas ref={ref} className="bones-sky__pieces" style={{ width: w, height: h }} aria-hidden="true" />;
}

interface BoneDrag {
  index: number;
  pointer: number;
  x0: number;
  y0: number;
  base: NonNullable<BonesView['rig']>;
  moved: boolean;
}

export function Constellation({ ctl, view, wiggly, onWigglyDone, pieces }: ConstellationProps) {
  const sky = useRef<HTMLDivElement>(null);
  const size = useSize(sky);
  const reduced = useReducedMotion();
  const image = view.image;
  const rig = view.rig;
  const fit = useMemo(() => fitArt(size.w, size.h, image?.w ?? 1, image?.h ?? 1), [size.w, size.h, image?.w, image?.h]);
  const stars = useStableOrder(useMemo(() => (rig ? starsOf(rig) : []), [rig]));
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<{ index: number; anchor: DOMRect } | null>(null);
  const [wigglyLine, setWigglyLine] = useState<[Point, Point] | null>(null);
  const [guessHidden, setGuessHidden] = useState(false);
  const [focusStar, setFocusStar] = useState<string | null>(null);
  const focused = useCallback(() => setFocusStar(null), []);
  const boneDrag = useRef<BoneDrag | null>(null);
  const busy = !!view.busy;

  // a joint that no longer exists (undo, a new kind) can't stay selected
  useEffect(() => {
    if (selected && !stars.some((s) => s.sid === selected)) setSelected(null);
  }, [stars, selected]);

  useEffect(() => {
    if (!wiggly) setWigglyLine(null);
    else announce(t('bones.wigglyHint'));
  }, [wiggly]);

  const step = view.step;
  const reasons = step && step.confidence < 0.6 && step.made !== 'hand' ? guessReasons(step.issues, step.notes) : null;

  const boneRect = (index: number): DOMRect | null => {
    const b = rig?.bones[index];
    const r = sky.current?.getBoundingClientRect();
    if (!b || !r) return null;
    const x = r.left + fit.ox + ((b.x + b.x2) / 2) * fit.k;
    const y = r.top + fit.oy + ((b.y + b.y2) / 2) * fit.k;
    return new DOMRect(x - 6, y - 6, 12, 12);
  };

  const onBoneDown = (index: number, e: PointerEvent<SVGLineElement>) => {
    if (busy || !rig || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    boneDrag.current = { index, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, base: rig, moved: false };
  };

  const onBoneMove = (e: PointerEvent<SVGLineElement>) => {
    const d = boneDrag.current;
    if (!d || d.pointer !== e.pointerId || wiggly) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) playUiSound('pick');
    d.moved = true;
    ctl.preview(moveBone(d.base, d.base.bones[d.index].name, dx / fit.k, dy / fit.k));
  };

  const onBoneUp = (e: PointerEvent<SVGLineElement>) => {
    const d = boneDrag.current;
    if (!d || d.pointer !== e.pointerId) return;
    boneDrag.current = null;
    if (d.moved) {
      ctl.endPreview();
      playUiSound('put');
      return;
    }
    if (wiggly && rig) {
      // in wiggly mode a tap on a bone grows a wiggly bit from that spot, pointing away from the body
      const r = sky.current?.getBoundingClientRect();
      if (r) {
        const at = toArt(fit, e.clientX - r.left, e.clientY - r.top);
        const [cx0, cy0] = bodyCentre(rig);
        const dx = at[0] - cx0, dy = at[1] - cy0;
        const len = Math.hypot(dx, dy);
        const reach = 0.2 * boneHeight(rig);
        const dir: Point = len < 1 ? [0, -1] : [dx / len, dy / len];
        finishWiggly(ctl.addWiggly(at, [at[0] + dir[0] * reach, at[1] + dir[1] * reach]));
      }
      return;
    }
    setSelected(null);
    setCard({ index: d.index, anchor: new DOMRect(e.clientX - 6, e.clientY - 6, 12, 12) });
  };

  const onBoneCancel = (e: PointerEvent<SVGLineElement>) => {
    const d = boneDrag.current;
    if (!d || d.pointer !== e.pointerId) return;
    boneDrag.current = null;
    if (d.moved) ctl.cancelPreview();
  };

  const finishWiggly = (tip: string | null) => {
    onWigglyDone();
    if (tip) {
      setSelected(tip);
      setFocusStar(tip);
      announce(t('bones.wigglyAdded'));
      playUiSound('put');
    }
  };

  const onSkyDown = (e: PointerEvent<HTMLDivElement>) => {
    // a tap on the empty sky puts the star's name away
    if (e.target === sky.current || (e.target as Element).classList?.contains('bones-sky__art')) {
      setSelected(null);
    }
  };

  const remove = (index: number) => {
    if (!rig) return;
    const bone = boneName(rig, index);
    const removed = ctl.removeBone(rig.bones[index].name);
    setCard(null);
    if (!removed) {
      showToast(t('bones.boneLast'));
      return;
    }
    showToast(removed > 1 ? t('bones.boneRemovedMore', { bone, n: removed - 1 }) : t('bones.boneRemoved', { bone }));
  };

  const hold = (index: number, held: boolean) => {
    if (!rig) return;
    const bone = boneName(rig, index);
    ctl.setHolding(rig.bones[index].name, held);
    announce(held ? t('bones.boneHeldOn', { bone }) : t('bones.boneHeldOff', { bone }));
  };

  if (!image) return null;
  const artBox = { left: fit.ox, top: fit.oy, width: image.w * fit.k, height: image.h * fit.k };
  const ready = size.w > 0;

  return (
    <div
      ref={sky}
      className={cx('bones-sky', wiggly && 'bones-sky--wiggly', busy && 'bones-sky--busy')}
      role="application"
      aria-label={t('bones.skyLabel', { name: view.name, n: stars.length })}
      aria-describedby="bones-keys"
      aria-busy={busy || undefined}
      onPointerDown={onSkyDown}
    >
      <svg className="bones-sky__stars" width="100%" height="100%" aria-hidden="true" focusable="false">
        {SKY_STARS.map(([x, y, r], i) => (
          <circle key={i} cx={`${x * 100}%`} cy={`${y * 100}%`} r={r} />
        ))}
      </svg>
      {ready && (
        <>
          <img className="bones-sky__art" src={image.url} alt="" draggable={false} style={artBox} />
          {pieces && view.bound && <PiecesCanvas bound={view.bound} fit={fit} w={size.w} h={size.h} />}
          {busy && !reduced && <div className="bones-sky__shimmer" style={artBox} aria-hidden="true" />}
          {rig && (
            <BoneLines
              rig={rig}
              fit={fit}
              w={size.w}
              h={size.h}
              dim={busy}
              selectedBone={card?.index ?? null}
              wigglyLine={wigglyLine}
              onBoneDown={onBoneDown}
              onBoneMove={onBoneMove}
              onBoneUp={onBoneUp}
              onBoneCancel={onBoneCancel}
            />
          )}
          {rig && (
            <JointLayer
              ctl={ctl}
              rig={rig}
              stars={stars}
              fit={fit}
              sky={size}
              skyEl={sky}
              selected={selected}
              onSelect={setSelected}
              busy={busy}
              wiggly={wiggly}
              onWigglyLine={setWigglyLine}
              onWigglyDone={finishWiggly}
              focusStar={focusStar}
              onFocused={focused}
            />
          )}
          {reasons && !guessHidden && !busy && <GuessNote reasons={reasons} fit={fit} sky={size} onClose={() => setGuessHidden(true)} />}
        </>
      )}
      <div className="bones-sky__foot">
        {wiggly ? (
          <p className="bones-sky__wiggly-hint" id="bones-keys">
            <span aria-hidden="true" className="bones-sky__wiggly-icon">
              ∿
            </span>{' '}
            {t('bones.wigglyHint')} <span className="bones-sky__wiggly-keys">{t('bones.wigglyKeys')}</span>
          </p>
        ) : (
          <p className="bones-sky__keys" id="bones-keys">
            <span>
              <Keycap>Tab</Keycap> {t('bones.keysNext')}
            </span>
            <span>
              <Keycap label={t('bones.keyArrows')}>← ↑ → ↓</Keycap> {t('bones.keysNudge')}
            </span>
            <span>
              <Keycap>Enter</Keycap> {t('bones.keysPick')}
            </span>
          </p>
        )}
        <p className="bones-sky__legend">
          <span className="legend-item">
            <span className="legend-star legend-star--L" aria-hidden="true">L</span>
            <span className="legend-swatch legend-swatch--L" aria-hidden="true" />
            {t('bones.legendLeft')}
          </span>
          <span className="legend-item">
            <span className="legend-star legend-star--R" aria-hidden="true">R</span>
            <span className="legend-swatch legend-swatch--R" aria-hidden="true" />
            {t('bones.legendRight')}
          </span>
        </p>
      </div>
      {rig && (
        <BoneTree
          rig={rig}
          name={view.name}
          onOpen={(index) => {
            const anchor = boneRect(index);
            if (anchor) setCard({ index, anchor });
          }}
        />
      )}
      {rig && card && rig.bones[card.index] && (
        <BoneCard
          rig={rig}
          index={card.index}
          anchor={card.anchor}
          onClose={() => setCard(null)}
          onRemove={() => remove(card.index)}
          onHold={(held) => hold(card.index, held)}
        />
      )}
    </div>
  );
}
