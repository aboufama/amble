/**
 * `#/trail/list` (§2.4): the student's worlds as a grid of cards (snapshot, name, last edited, cast
 * stickers), sorted by Recent or Name. The choice of List or Trail is remembered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../../app/Link';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { editedText, lostWorlds, sortWorlds, type WorldSort } from '../../home/trailData';
import type { ArtId, WorldMeta } from '../../model/types';
import { setPrefs } from '../../state/prefs';
import { useStore } from '../../state/store';
import { Button, PlaceholderGlyph, Segmented } from '../../ui/components';
import { Icon } from '../../ui/icons';

/** An object URL loaded for `key` (the loader runs again only when the key changes). */
function useUrl(key: string | null, load: () => Promise<string | null>): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (key)
      void loader.current()
        .then((u) => live && setUrl(u))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return url;
}

function Sticker({ id }: { id: ArtId }) {
  const { store } = useServices();
  const url = useUrl(id, async () => {
    const rec = await store.art.get(id);
    return rec?.export ? store.blobs.url(rec.export.sticker) : null;
  });
  return url ? <img className="world-card__sticker" src={url} alt="" /> : null;
}

function edited(at: number, now: number): string {
  const e = editedText(at, now);
  if (e.key === 'editedMinutes' || e.key === 'editedHours' || e.key === 'editedDays') return t(`home.${e.key}`, { n: e.n });
  if (e.key === 'editedDate') return t('home.editedDate', { date: e.date });
  return t(`home.${e.key}`);
}

function WorldCard({ meta, now }: { meta: WorldMeta; now: number }) {
  const { store } = useServices();
  const snap = useUrl(meta.snapshot, async () => (meta.snapshot ? store.blobs.url(meta.snapshot) : null));
  const hero = useUrl(meta.snapshot ? null : meta.hero, async () => {
    const rec = meta.hero ? await store.art.get(meta.hero) : null;
    return rec?.export ? store.blobs.url(rec.export.sticker) : null;
  });
  const cast = [...new Set([meta.hero, ...meta.walkers].filter((a): a is ArtId => Boolean(a)))].slice(0, 4);
  return (
    <li className="world-card">
      <Link to={{ name: 'world', id: meta.id }} className="world-card__link" data-testid="world-card">
        <span className="world-card__thumb">
          {snap ? <img src={snap} alt="" /> : hero ? <img className="world-card__hero" src={hero} alt="" /> : <PlaceholderGlyph rig="biped" role="hero" size={56} />}
        </span>
        <span className="world-card__name">{meta.title}</span>
        <span className="world-card__meta">{edited(meta.updatedAt, now)}</span>
        <span className="world-card__cast">
          {cast.map((id) => (
            <Sticker key={id} id={id} />
          ))}
          <span className="world-card__count">{t('home.drawnCount', { drawn: meta.drawn, needed: meta.needed })}</span>
        </span>
      </Link>
    </li>
  );
}

export function ListView() {
  const worlds = useStore((s) => s.library.worlds);
  const [sort, setSort] = useState<WorldSort>(() => {
    try {
      return sessionStorage.getItem('amble.trailSort') === 'name' ? 'name' : 'recent';
    } catch {
      return 'recent';
    }
  });
  const now = Date.now();
  const list = useMemo(() => sortWorlds(worlds, sort), [worlds, sort]);
  const lost = lostWorlds(worlds, now).length;

  useEffect(() => {
    setPrefs({ trailView: 'list' });
  }, []);

  const back = () => {
    setPrefs({ trailView: 'trail' });
    navigate({ name: 'trail', view: 'trail' });
  };

  return (
    <section className="trail-list" aria-labelledby="trail-list-title" data-testid="trail-list-view">
      <div className="trail-list__head">
        <div>
          <h1 id="trail-list-title" className="trail-list__title">
            {t('home.listTitle')}
          </h1>
          <p className="trail-list__lede">{t('home.listLede')}</p>
        </div>
        <div className="trail-list__tools">
          <Segmented
            label={t('home.sortLabel')}
            value={sort}
            options={[
              { value: 'recent', label: t('home.sortRecent') },
              { value: 'name', label: t('home.sortName') },
            ]}
            onChange={(v) => {
              setSort(v as WorldSort);
              try {
                sessionStorage.setItem('amble.trailSort', v);
              } catch {
                // Remembering the sort is a nicety.
              }
            }}
          />
          <Button variant="ghost" icon="trail" onClick={back} data-testid="back-to-trail">
            {t('home.backToTrail')}
          </Button>
        </div>
      </div>
      {list.length ? (
        <ul className="trail-list__grid" aria-label={t('home.listTitle')}>
          {list.map((m) => (
            <WorldCard key={m.id} meta={m} now={now} />
          ))}
        </ul>
      ) : (
        <p className="trail-list__empty">{t('home.listEmpty')}</p>
      )}
      {lost > 0 && (
        <Link to={{ name: 'trail', view: 'lost' }} className="btn btn--quiet btn--h44 trail-list__lost" data-testid="lost-link">
          <Icon name="restart" size={20} />
          <span className="btn__label">{t('home.lostLink', { n: lost })}</span>
        </Link>
      )}
    </section>
  );
}
