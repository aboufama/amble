/**
 * `#/trail/lost` Lost and found (§2.4, §1.5 law 4): worlds the student put away, each with the days it
 * has left (30 in all) and **Bring it back**. Worlds past their 30 days are removed when this opens.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { expiredWorlds, lostWorlds } from '../../home/trailData';
import type { WorldId } from '../../model/types';
import { announce } from '../../state/app';
import { refreshLibrary } from '../../state/library';
import { useStore } from '../../state/store';
import { Button } from '../../ui/components';
import { Link } from '../../app/Link';

/** `days` counts the day it is on (30 right after Put away, 1 on its last day). */
function leftWords(days: number): string {
  return days <= 1 ? t('home.lastDay') : t('home.daysLeft', { n: days });
}

export function LostAndFound() {
  const { store } = useServices();
  const worlds = useStore((s) => s.library.worlds);
  const [busy, setBusy] = useState<WorldId | null>(null);
  const now = Date.now();
  const list = lostWorlds(worlds, now);

  useEffect(() => {
    const gone = expiredWorlds(worlds, Date.now());
    if (!gone.length) return;
    void Promise.all(gone.map((id) => store.worlds.purge(id).catch(() => undefined))).then(() => refreshLibrary(store));
  }, [worlds, store]);

  const bringBack = async (id: WorldId, title: string) => {
    setBusy(id);
    try {
      await store.worlds.restore(id);
      await refreshLibrary(store);
      announce(t('home.broughtBack', { title }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="trail-list lost" aria-labelledby="lost-title" data-testid="lost-view">
      <div className="trail-list__head">
        <div>
          <h1 id="lost-title" className="trail-list__title">
            {t('home.lostTitle')}
          </h1>
          <p className="trail-list__lede">{t('home.lostLede')}</p>
        </div>
        <Link to={{ name: 'trail', view: 'trail' }} className="btn btn--ghost btn--h44">
          <span className="btn__label">{t('home.backToTrail')}</span>
        </Link>
      </div>
      {list.length ? (
        <ul className="lost__list">
          {list.map(({ meta, daysLeft }) => (
            <li key={meta.id} className="lost__item" data-testid="lost-item">
              <span className="lost__name">{meta.title}</span>
              <span className="lost__left">{leftWords(daysLeft)}</span>
              <Button variant="lantern" size={38} icon="restart" busy={busy === meta.id} onClick={() => void bringBack(meta.id, meta.title)} data-testid="bring-back">
                {t('home.bringItBack')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="trail-list__empty">{t('home.lostEmpty')}</p>
      )}
    </section>
  );
}
