/**
 * `#/teacher/present` Present mode (§2.14): the gallery on the projector. Day theme, 150 % UI scale, names
 * and initials hidden (Show names is off by default), a large world view with ◀ ▶.
 */
import { useEffect, useRef, useState } from 'react';
import { useCommand, useEscape } from '../../app/keys';
import { Link } from '../../app/Link';
import { GameAccess } from '../../app/player/GameAccess';
import { t } from '../../i18n';
import { selectGalleryItem, useGallery } from '../../school/gallery';
import { enterPresent } from '../../school/present';
import { announce } from '../../state/app';
import { Button, Footprints, Toggle } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { isTextField } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { SchoolIcon } from './SchoolIcon';
import { useGalleryPlayer } from './useGalleryPlayer';

export function PresentMode() {
  const gallery = useGallery();
  const [showNames, setShowNames] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => enterPresent(), []);
  const items = gallery.items.filter((i) => i.status === 'ready');
  const selected = items.find((i) => i.id === gallery.selected) ?? items[0] ?? null;
  const index = selected ? items.indexOf(selected) : -1;
  const game = useGalleryPlayer(selected, slot);

  const move = (delta: -1 | 1) => {
    if (!items.length) return;
    const next = items[(Math.max(0, index) + delta + items.length) % items.length];
    selectGalleryItem(next.id);
    announce(t('school.staff_nowShowing', { title: next.title, n: items.indexOf(next) + 1, total: items.length }));
  };

  useCommand('restart', () => (game.state === 'playing' ? (game.restart(), true) : false));
  useCommand('fullscreen', () => (game.state === 'playing' ? (game.fullscreen(), true) : false));
  useEscape(() => (game.state === 'playing' ? (game.stop(), true) : false), game.state === 'playing');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTextField(e.target)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        move(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="screen present" data-testid="screen-teacher">
      <header className="present__top">
        <Link to={{ name: 'teacher', tab: 'gallery' }} className="btn btn--ghost btn--h44">
          <Icon name="back" size={20} />
          <span className="btn__label">{t('school.staff_leavePresent')}</span>
        </Link>
        <h1 className="present__title">
          {selected ? selected.title : t('school.staff_presentTitle')}
          {selected && showNames && selected.madeBy && <span className="present__by">{t('school.staff_by', { name: selected.madeBy })}</span>}
        </h1>
        {selected && <span className="present__count">{t('school.staff_nOfTotal', { n: index + 1, total: items.length })}</span>}
        <Toggle label={t('school.staff_showNames')} checked={showNames} onChange={setShowNames} className="present__names" />
      </header>
      <main id="main" tabIndex={-1} className="present__main">
        {!selected ? (
          <div className="tempty tempty--big">
            <SchoolIcon name="present" size={44} />
            <p className="tempty__title">{t('school.staff_presentEmpty')}</p>
            <Link to={{ name: 'teacher', tab: 'gallery' }} className="btn btn--lantern btn--h44">
              <span className="btn__label">{t('school.staff_toGallery')}</span>
            </Link>
          </div>
        ) : (
          <>
            <div className={cx('present__view', `gdetail__view--${game.state}`)} ref={slot} data-testid="gallery-slot">
              {game.state !== 'playing' && selected.thumb && <img className="gdetail__poster" src={selected.thumb} alt="" />}
              {game.state === 'loading' && (
                <span className="gdetail__over">
                  <Footprints label={t('school.staff_starting')} />
                  {t('school.staff_starting')}
                </span>
              )}
              {game.state === 'stopped' && (
                <button type="button" className="gdetail__over gdetail__over--button" onClick={game.start}>
                  <Icon name="play" size={24} />
                  {t('school.staff_playAgain')}
                </button>
              )}
              {game.state === 'failed' && (
                <span className="gdetail__over gdetail__over--bad">
                  <Icon name="warning" size={22} />
                  {t('school.staff_cantStart')}
                </span>
              )}
              <GameAccess />
            </div>
            <div className="present__foot">
              <Button variant="ghost" size={58} icon="back" onClick={() => move(-1)} disabled={items.length < 2}>
                {t('school.staff_previous')}
              </Button>
              <button type="button" className="btn btn--quiet btn--h44" aria-pressed={!game.muted} onClick={game.toggleSound} disabled={game.state !== 'playing'}>
                <Icon name="sound" size={20} />
                <span className="btn__label">{game.muted ? t('school.staff_soundOff') : t('school.staff_soundOn')}</span>
              </button>
              <button type="button" className="btn btn--ghost btn--h58" onClick={() => move(1)} disabled={items.length < 2}>
                <span className="btn__label">{t('school.staff_next')}</span>
                <SchoolIcon name="next" size={24} />
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
