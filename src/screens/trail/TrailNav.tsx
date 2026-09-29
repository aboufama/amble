/**
 * The trail's nav cluster, bottom right (§2.4): a small white toolbar with how many worlds, ◂ ▸ (three
 * signs at a time), **List** and **⏸ Pause the trail** (stops the walkers; remembered in
 * `prefs.trailPaused`).
 */
import { t } from '../../i18n';
import { Button, IconButton } from '../../ui/components';

export interface TrailNavProps {
  mine: number;
  starters: number;
  paused: boolean;
  canLeft: boolean;
  canRight: boolean;
  onLeft(): void;
  onRight(): void;
  onList(): void;
  onPause(): void;
}

export function TrailNav({ mine, starters, paused, canLeft, canRight, onLeft, onRight, onList, onPause }: TrailNavProps) {
  const count = mine > 0 ? `${mine === 1 ? t('home.countOneMine') : t('home.countMine', { n: mine })} · ${t('home.countStarters', { n: starters })}` : t('home.countStarters', { n: starters });
  return (
    <nav className="trail-nav" aria-label={t('home.signsLabel')}>
      <span className="trail-nav__count">{count}</span>
      <IconButton icon="back" label={t('home.walkLeft')} variant="quiet" size={44} onClick={onLeft} disabled={!canLeft} data-testid="trail-left" />
      <IconButton icon="back" label={t('home.walkRight')} variant="quiet" size={44} onClick={onRight} disabled={!canRight} className="trail-nav__right" data-testid="trail-right" />
      <Button variant="quiet" size={44} icon="list" onClick={onList} data-testid="trail-list">
        {t('home.list')}
      </Button>
      <IconButton icon={paused ? 'play' : 'pause'} label={paused ? t('home.playTrail') : t('home.pauseTrail')} variant="quiet" size={44} pressed={paused} onClick={onPause} data-testid="trail-pause" />
    </nav>
  );
}
