/**
 * The Flipbook row under Layers (§2.10, §7.12; optional): one page by default ("Bones make it move, or
 * draw more pages for your own animation"); with more, the pages as numbered buttons (`,` and `.` step
 * through them), Play, See the pages around this one (onion skin), Delete this page, **Pages for** (the
 * move the pages replace in the game) and how many pages a second. Opened from Bones' "Draw this move
 * yourself?", it scrolls into view with that move picked.
 */
import { useEffect, useRef } from 'react';
import { movesFor, moveWord } from '../../bones/words';
import type { CharacterKind } from '../../cores/rig';
import type { DeskController, DeskState } from '../../draw/deskController';
import { t } from '../../i18n';
import { Menu, Slider } from '../../ui/components';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';
import { DeskIcon } from './DeskIcons';

export function FlipbookPanel({ ctrl, s, focus }: { ctrl: DeskController; s: DeskState; focus: boolean }) {
  const pages = s.frames;
  const one = pages.length <= 1;
  const section = useRef<HTMLElement>(null);
  const kind = (s.kind === 'none' ? 'object' : s.kind) as CharacterKind;
  const rigged = ctrl.request.kind === 'character' && s.kind !== 'none';

  // Opened to draw a move: bring the Flipbook into view.
  useEffect(() => {
    if (!focus) return;
    section.current?.scrollIntoView({ block: 'nearest' });
    section.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [focus]);

  return (
    <section ref={section} className="side__section flip" aria-labelledby="desk-flip">
      <div className="side__head">
        <h2 id="desk-flip" className="side__title">
          {t('draw.flipbook')}
        </h2>
        <span className="side__meta">{one ? t('draw.optional') : t('draw.flipbookPages', { n: pages.length })}</span>
      </div>
      {one ? (
        <div className="flip__one">
          <DeskIcon name="pages" size={22} />
          <p>{s.flip.move && rigged ? t('draw.flipbookFor', { move: moveWord(s.flip.move) }) : t('draw.flipbookOne')}</p>
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
            <button type="button" className="btn btn--ghost btn--h38" aria-pressed={s.playing} onClick={() => (s.playing ? ctrl.stopFlipbook() : void ctrl.playFlipbook(s.flip.fps))}>
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
          {rigged && (
            <div className="flip__for">
              <span className="side__label">{t('draw.pagesFor')}</span>
              <Menu
                label={s.flip.move ? moveWord(s.flip.move) : t('draw.pagesForNone')}
                showLabel
                variant="ghost"
                size={38}
                align="start"
                items={movesFor(kind).map((m) => ({ id: m, label: moveWord(m), onSelect: () => ctrl.setFlip({ move: m }) }))}
              />
            </div>
          )}
          <Slider className="brush__slider flip__speed" label={t('draw.pagesSpeedLabel')} min={4} max={12} value={s.flip.fps} format={(v) => t('draw.pagesSpeed', { n: v })} onChange={(v) => ctrl.setFlip({ fps: v })} />
        </>
      )}
    </section>
  );
}
