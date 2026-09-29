/**
 * The Flipbook row under Layers (§2.10, optional): one page by default ("Bones make it move, or draw more
 * pages for your own animation"); with more, the pages as numbered buttons (`,` and `.` step through
 * them), Play, See the pages around this one (onion skin), and Delete this page.
 */
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';
import { DeskIcon } from './DeskIcons';

const FPS = 8;

export function FlipbookPanel({ ctrl, s }: { ctrl: DeskController; s: DeskState }) {
  const pages = s.frames;
  const one = pages.length <= 1;
  return (
    <section className="side__section flip" aria-labelledby="desk-flip">
      <div className="side__head">
        <h2 id="desk-flip" className="desk-caps">
          {t('draw.flipbook')}
        </h2>
        <span className="side__meta">{one ? t('draw.optional') : t('draw.flipbookPages', { n: pages.length })}</span>
      </div>
      {one ? (
        <div className="flip__one">
          <DeskIcon name="pages" size={22} />
          <p>{t('draw.flipbookOne')}</p>
          <button type="button" className="btn btn--ghost btn--h38 flip__add" onClick={() => void ctrl.addFrame(true)}>
            <Icon name="plus" size={18} />
            <span className="btn__label">{t('draw.addPage')}</span>
          </button>
        </div>
      ) : (
        <>
          <ol className="flip__pages" aria-label={t('draw.flipbook')}>
            {pages.map((f, i) => (
              <li key={f.id}>
                <button type="button" className={cx('flip__page', f.id === s.frame && 'flip__page--on')} aria-current={f.id === s.frame ? 'true' : undefined} aria-label={t('draw.pageN', { n: i + 1 })} onClick={() => void ctrl.selectFrame(f.id)}>
                  {i + 1}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="flip__page flip__page--add" aria-label={t('draw.copyPage')} title={t('draw.copyPage')} onClick={() => void ctrl.addFrame(true)}>
                <Icon name="plus" size={16} />
              </button>
            </li>
          </ol>
          <div className="flip__actions">
            <button type="button" className="btn btn--ghost btn--h38" aria-pressed={s.playing} onClick={() => (s.playing ? ctrl.stopFlipbook() : void ctrl.playFlipbook(FPS))}>
              <Icon name={s.playing ? 'pause' : 'play'} size={18} />
              <span className="btn__label">{s.playing ? t('draw.stopPages') : t('draw.playPages')}</span>
            </button>
            <button type="button" className={cx('btn btn--quiet btn--h38 btn--icon', s.onion && 'flip__onion--on')} aria-pressed={s.onion} aria-label={t('draw.onionSkin')} title={t('draw.onionSkin')} onClick={() => ctrl.setOnion(!s.onion)}>
              <Icon name="layer" size={18} />
            </button>
            <button type="button" className="btn btn--quiet btn--h38 btn--icon" aria-label={t('draw.deletePage')} title={t('draw.deletePage')} onClick={() => ctrl.removeFrame(s.frame)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
