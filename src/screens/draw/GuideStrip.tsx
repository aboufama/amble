/**
 * The guide strip above the sheet (characters only, §2.10): **On the bones | Freehand**; on the bones the
 * step chips (tapped, never advanced by themselves) with ✓ on the steps that have ink, the other side of a
 * two-part step, and **Copy it to the other side**; in Freehand the star-pose **Guides** toggle.
 */
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
  const canCopy = s.mode === 'bones' && !!part && !!other && !!s.parts[other];
  return (
    <div className="strip" role="region" aria-label={t('draw.guideStripLabel')}>
      {bones && (
        <Segmented
          label={t('draw.guideStripLabel')}
          size={38}
          className="strip__mode"
          value={s.mode}
          onChange={(m) => ctrl.setMode(m)}
          options={[
            { value: 'bones', label: t('draw.onTheBones'), icon: 'bones' },
            { value: 'free', label: t('draw.freehand'), icon: 'draw' },
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
                    onClick={() => ctrl.setStep(i)}
                  >
                    <span className="strip__num" aria-hidden="true">
                      {(done || some) && !on ? <Icon name="check" size={14} /> : i + 1}
                    </span>
                    <span>{name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="strip__end">
            {step && step.parts.length > 1 && part && (
              <div className="strip__sides" role="group" aria-label={stepLabel(step.step)}>
                {step.parts.map((p) => (
                  <button key={p} type="button" className={cx('strip__side', p === part && 'strip__side--on')} aria-pressed={p === part} onClick={() => ctrl.setPart(p)}>
                    {partLabel(p)}
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
              <button type="button" className="btn btn--ghost btn--h38 strip__action" onClick={() => ctrl.copyToOtherSide()}>
                <Icon name="mirror" size={18} />
                <span className="btn__label">{t('draw.copyOther')}</span>
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="strip__end">
          {bones && <Toggle className="strip__toggle" label={t('draw.guides')} checked={s.starPose} onChange={(on) => ctrl.setStarPose(on)} />}
        </div>
      )}
    </div>
  );
}
