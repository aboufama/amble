/**
 * The view bar under the sheet (§2.10): **− 62 % +**, **Fit**, and the **Mirror**, **Guides** and
 * **Steady** switches, in one flat bar like the zoom buttons under Scratch's paint editor. Pan and zoom
 * always have buttons here (WCAG 2.5.7), besides pinch and Ctrl+wheel.
 */
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';

export function ViewBar({ ctrl, s }: { ctrl: DeskController; s: DeskState }) {
  return (
    <div className="viewbar" role="toolbar" aria-label={t('draw.viewLabel')}>
      <div className="viewbar__zoom">
        <button type="button" className="viewbar__icon" aria-label={t('draw.zoomOut')} onClick={() => ctrl.zoomBy(1 / 1.25)}>
          <Icon name="zoomOut" size={20} />
        </button>
        <output className="viewbar__pct" aria-live="off">
          {t('draw.zoomLevel', { n: s.zoom })}
        </output>
        <button type="button" className="viewbar__icon" aria-label={t('draw.zoomIn')} onClick={() => ctrl.zoomBy(1.25)}>
          <Icon name="zoomIn" size={20} />
        </button>
      </div>
      <button type="button" className="viewbar__btn" onClick={() => ctrl.fit()} aria-keyshortcuts="F">
        {t('draw.fit')}
      </button>
      <span className="viewbar__sep" aria-hidden="true" />
      <Toggle className="viewbar__switch" label={t('draw.mirror')} checked={s.mirror} onChange={(on) => ctrl.setMirror(on)} />
      <Toggle className="viewbar__switch" label={t('draw.guides')} checked={s.guides} onChange={(on) => ctrl.setGuides(on)} />
      <Toggle className="viewbar__switch" label={t('draw.steady')} checked={s.steady} onChange={(on) => ctrl.toggleSteady(on)} />
    </div>
  );
}
