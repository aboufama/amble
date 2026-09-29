/**
 * The active tool's options (§2.10): Fill (Gaps Auto / Small / Off, Fill all of this colour, Lasso fill),
 * Shapes (Line / Box / Circle / Curve, Filled or Outline), Select (Lasso / Box, then Turn, Flip, Put it
 * down, Delete it, Make it a part), Eraser (Hard / Soft), Ink (Tap to ink), and **Make it perfect** for
 * the brushes (hold-to-perfect without the timing, for motor accessibility).
 */
import type { DeskController, DeskState } from '../../draw/deskController';
import { luminance } from '../../draw/colorNames';
import { t } from '../../i18n';
import { Menu, Segmented, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { partLabel } from './GuideStrip';
import { toolLabel } from './ToolRail';

const PERFECTABLE = new Set(['ink', 'pencil', 'marker', 'crayon', 'pixel']);

/** Part names a selection can become ("Which part is this?"). */
const PART_CHOICES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR', 'tail', 'wingL', 'wingR'];

export function hasOptions(tool: DeskState['tool']): boolean {
  return tool !== 'airbrush';
}

export function ToolOptions({ ctrl, s, heading = true }: { ctrl: DeskController; s: DeskState; heading?: boolean }) {
  const tool = s.tool;
  const sel = s.selection;
  const body = (() => {
    switch (tool) {
      case 'fill':
        return (
          <>
            <Segmented
              label={t('draw.gaps')}
              size={38}
              value={s.fill.gaps}
              onChange={(gaps) => ctrl.setFill({ gaps })}
              options={[
                { value: 'auto', label: t('draw.gapsAuto') },
                { value: 'small', label: t('draw.gapsSmall') },
                { value: 'off', label: t('draw.gapsOff') },
              ]}
            />
            <Toggle label={t('draw.fillAll')} checked={s.fill.all} onChange={(all) => ctrl.setFill({ all, lasso: all ? false : s.fill.lasso })} />
            <Toggle label={t('draw.lassoFill')} hint={t('draw.lassoFillHint')} checked={s.fill.lasso} onChange={(lasso) => ctrl.setFill({ lasso, all: lasso ? false : s.fill.all })} />
          </>
        );
      case 'shapes':
        return (
          <>
            <Segmented
              label={t('draw.tool_shapes')}
              size={38}
              value={s.shape.kind}
              onChange={(kind) => ctrl.setShape({ kind })}
              options={[
                { value: 'line', label: t('draw.shapeLine') },
                { value: 'rect', label: t('draw.shapeBox') },
                { value: 'ellipse', label: t('draw.shapeCircle') },
                { value: 'curve', label: t('draw.shapeCurve') },
              ]}
            />
            <Segmented
              label={t('draw.filled')}
              size={38}
              value={s.shape.filled ? 'filled' : 'outline'}
              onChange={(v) => ctrl.setShape({ filled: v === 'filled' })}
              options={[
                { value: 'outline', label: t('draw.outline') },
                { value: 'filled', label: t('draw.filled') },
              ]}
            />
            <p className="opts__hint">{s.shape.kind === 'curve' ? t('draw.shapeCurveHint') : t('draw.sheetHelp')}</p>
          </>
        );
      case 'select':
        return (
          <>
            <Segmented
              label={t('draw.tool_select')}
              size={38}
              value={s.select}
              onChange={(m) => ctrl.setSelectMode(m)}
              options={[
                { value: 'lasso', label: t('draw.selectLasso'), icon: 'lasso' },
                { value: 'box', label: t('draw.selectBox') },
              ]}
            />
            {sel?.floating ? (
              <div className="opts__row opts__row--wrap">
                <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.turnSelection(90)}>
                  <Icon name="restart" size={18} />
                  <span className="btn__label">{t('draw.selTurn')}</span>
                </button>
                <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.flipSelection('h')}>
                  <Icon name="mirror" size={18} />
                  <span className="btn__label">{t('draw.selFlip')}</span>
                </button>
                <button type="button" className="btn btn--ghost btn--h38" onClick={() => ctrl.flipSelection('v')}>
                  <span className="btn__label">{t('draw.selFlipUp')}</span>
                </button>
                <button type="button" className="btn btn--lantern btn--h38" onClick={() => ctrl.commitSelection()}>
                  <Icon name="check" size={18} />
                  <span className="btn__label">{t('draw.selDone')}</span>
                </button>
                <button type="button" className="btn btn--danger btn--h38" onClick={() => ctrl.deleteSelection()}>
                  <span className="btn__label">{t('draw.selDelete')}</span>
                </button>
                <Menu
                  label={t('draw.makePart')}
                  showLabel
                  variant="ghost"
                  size={38}
                  align="start"
                  items={PART_CHOICES.map((p) => ({ id: p, label: partLabel(p), onSelect: () => void ctrl.selectionToPart(p) }))}
                />
              </div>
            ) : (
              <p className="opts__hint">{t('draw.selectHint')}</p>
            )}
          </>
        );
      case 'eraser':
        return (
          <Segmented
            label={t('draw.tool_eraser')}
            size={38}
            value={s.eraserSoft ? 'soft' : 'hard'}
            onChange={(v) => ctrl.setEraserSoft(v === 'soft')}
            options={[
              { value: 'hard', label: t('draw.eraserHard') },
              { value: 'soft', label: t('draw.eraserSoft') },
            ]}
          />
        );
      default:
        return (
          <>
            {tool === 'ink' && <Toggle label={t('draw.tapToInk')} hint={s.tapToInk ? t('draw.tapToInkHint') : undefined} checked={s.tapToInk} onChange={(on) => ctrl.setTapToInk(on)} />}
            {tool === 'marker' && luminance(s.color) > 0.72 && <p className="opts__hint">{t('draw.markerLight')}</p>}
            {PERFECTABLE.has(tool) && (
              <button type="button" className="btn btn--ghost btn--h38 opts__perfect" onClick={() => void ctrl.makePerfect()}>
                <Icon name="sparkle" size={18} />
                <span className="btn__label">{t('draw.makePerfect')}</span>
              </button>
            )}
          </>
        );
    }
  })();
  return (
    <section className="opts" aria-label={t('draw.toolOptions', { tool: toolLabel(tool) })}>
      {heading && <h2 className="desk-caps opts__title">{t('draw.toolOptions', { tool: toolLabel(tool) })}</h2>}
      <div className="opts__body">{body}</div>
    </section>
  );
}
