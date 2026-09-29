/**
 * The guide strip above the sheet (characters only, §2.10): **On the bones | Freehand**; on the bones the
 * step chips (tapped, never advanced by themselves) with ✓ on the steps that have ink, the sides of a
 * two-part step (Left, Right), and **Copy it to the other side** once the part has ink; in Freehand the
 * guide shape's switch. When the strip is short of room it drops icons, then words that have a tooltip
 * and an accessible name, so every step stays in view.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { DeskController, DeskState } from '../../draw/deskController';
import { otherSide } from '../../draw/parts';
import { lookup, t } from '../../i18n';
import { Segmented, Toggle } from '../../ui/components';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';

export function partLabel(name: string): string {
  const extra = /^extra(\d+)$/.exec(name);
  if (extra) return t('draw.part_extra', { n: extra[1] });
  return lookup(`draw.part_${name}`) ?? name;
}

export function stepLabel(step: string): string {
  return lookup(`draw.step_${step}`) ?? step;
}

const SIDE_KEYS: Record<string, string> = { legFL: 'front', legFR: 'otherFront', legBL: 'back', legBR: 'otherBack' };

/** The short word for a part beside its step ("Left", "Other back"). */
export function sideLabel(name: string): string {
  const key = /^(arm|leg|wing)L$/.test(name) ? 'left' : /^(arm|leg|wing)R$/.test(name) ? 'right' : SIDE_KEYS[name];
  return (key ? lookup(`draw.side_${key}`) : undefined) ?? partLabel(name);
}

export interface GuideStripProps {
  ctrl: DeskController;
  s: DeskState;
  /** The character can be drawn on the bones (a rig kind with limbs or a body). */
  bones: boolean;
}

export function GuideStrip({ ctrl, s, bones }: GuideStripProps) {
  const step = s.steps[s.step];
  const part = s.part;
  const other = part ? otherSide(part) : null;
  const canCopy = s.mode === 'bones' && !!part && !!other && !!s.parts[other] && s.drawn.includes(part);
  const ref = useRef<HTMLDivElement>(null);
  // 0: everything; 1: no icons on the switch; 2: Copy without words; 3: only the chosen step's name.
  const [tight, setTight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) < 1) return;
      last = el.clientWidth;
      setTight(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tighter until it fits (at most three steps; it starts over when the strip changes size).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.scrollWidth > el.clientWidth + 1 && tight < 3) setTight((n) => n + 1);
  });
  const shape = `${s.mode}|${s.step}|${canCopy}|${s.drawn.length}`;
  useLayoutEffect(() => setTight(0), [shape]);

  const copyLabel = t('draw.copyOther');
  return (
    <div ref={ref} className={cx('strip', `strip--tight${tight}`)} role="region" aria-label={t('draw.guideStripLabel')}>
      {bones && (
        <Segmented
          label={t('draw.guideStripLabel')}
          size={38}
          className="strip__mode"
          value={s.mode}
          onChange={(m) => ctrl.setMode(m)}
          options={[
            { value: 'bones', label: t('draw.onTheBones'), ...(tight < 1 ? { icon: 'bones' as const } : {}) },
            { value: 'free', label: t('draw.freehand'), ...(tight < 1 ? { icon: 'draw' as const } : {}) },
          ]}
        />
      )}
      {s.mode === 'bones' ? (
        <>
          <ol className="strip__steps" aria-label={t('draw.stepsLabel')}>
            {s.steps.map((st, i) => {
              const done = st.parts.length > 0 && st.parts.every((p) => s.drawn.includes(p));
              const some = st.parts.some((p) => s.drawn.includes(p));
              const on = i === s.step;
              const name = stepLabel(st.step);
              return (
                <li key={st.step}>
                  <button
                    type="button"
                    className={cx('strip__step', on && 'strip__step--on', (done || some) && 'strip__step--done')}
                    aria-current={on ? 'step' : undefined}
                    aria-label={on ? t('draw.stepNow', { step: name }) : done ? t('draw.stepDone', { step: name }) : name}
                    title={name}
                    onClick={() => ctrl.setStep(i)}
                  >
                    <span className="strip__num" aria-hidden="true">
                      {(done || some) && !on ? <Icon name="check" size={14} /> : i + 1}
                    </span>
                    {(tight < 3 || on) && <span>{name}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="strip__end">
            {step && step.parts.length > 1 && part && (
              <div className="strip__sides" role="group" aria-label={stepLabel(step.step)}>
                {step.parts.map((p) => (
                  <button key={p} type="button" className={cx('strip__side', p === part && 'strip__side--on')} aria-pressed={p === part} aria-label={partLabel(p)} onClick={() => ctrl.setPart(p)}>
                    {sideLabel(p)}
                    {s.drawn.includes(p) && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
            )}
            {step?.step === 'extras' && (
              <button type="button" className="btn btn--quiet btn--h38 strip__action" onClick={() => ctrl.addExtra() && ctrl.setStep(s.steps.findIndex((x) => x.step === 'extras'))}>
                <Icon name="plus" size={18} />
                <span className="btn__label">{t('draw.addExtra')}</span>
              </button>
            )}
            {canCopy && (
              <button type="button" className={cx('btn btn--ghost btn--h38 strip__action', tight >= 2 && 'btn--icon')} onClick={() => ctrl.copyToOtherSide()} aria-label={tight >= 2 ? copyLabel : undefined} title={copyLabel}>
                <Icon name="mirror" size={18} />
                {tight < 2 && <span className="btn__label">{copyLabel}</span>}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="strip__end">
          {bones && <Toggle className="strip__toggle" label={t('draw.guideShape')} checked={s.starPose} onChange={(on) => ctrl.setStarPose(on)} />}
        </div>
      )}
    </div>
  );
}
