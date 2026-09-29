/**
 * A world's sign on the trail (§2.4): a 170x96 frame on legs with a hanging lantern, the world's last
 * snapshot, and a paper name tag pinned at the bottom edge ("Edited 2 days ago", or "Starter · runner").
 * Assignment worlds carry a scroll and a "Due Fri" ribbon; handed-in worlds say so. The sign is a link
 * in the trail's list (roving focus: the Trail moves it with the arrow keys).
 */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { hrefOf } from '../../app/router';
import type { Route } from '../../app/routes';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { editedText } from '../../home/trailData';
import type { StarterId, StarterInfo, WorldMeta } from '../../model/types';
import { PlaceholderGlyph } from '../../ui/components';
import { cx } from '../../ui/cx';
import { SeedScene } from '../newworld/SeedScene';
import { BracketLantern } from './Landscape';

export type SignSource = { kind: 'world'; meta: WorldMeta } | { kind: 'starter'; info: StarterInfo };

export interface WorldSignProps {
  source: SignSource;
  x: number;
  /** Frame top, design px (bottom-anchored). */
  top: number;
  legs: number;
  index: number;
  focused: boolean;
  now: number;
  onFocus(index: number): void;
  onKeyDown(e: KeyboardEvent<HTMLAnchorElement>, index: number): void;
  onOpen(e: React.MouseEvent<HTMLAnchorElement>, route: Route, el: HTMLAnchorElement): void;
  onMenu?(el: HTMLElement): void;
  linkRef(el: HTMLAnchorElement | null): void;
}

function EditedLabel({ at, now }: { at: number; now: number }) {
  const e = editedText(at, now);
  switch (e.key) {
    case 'editedMinutes':
    case 'editedHours':
    case 'editedDays':
      return <>{t(`home.${e.key}`, { n: e.n })}</>;
    case 'editedDate':
      return <>{t('home.editedDate', { date: e.date })}</>;
    default:
      return <>{t(`home.${e.key}`)}</>;
  }
}

function editedWords(at: number, now: number): string {
  const e = editedText(at, now);
  if (e.key === 'editedMinutes' || e.key === 'editedHours' || e.key === 'editedDays') return t(`home.${e.key}`, { n: e.n });
  if (e.key === 'editedDate') return t('home.editedDate', { date: e.date });
  return t(`home.${e.key}`);
}

function ScrollIcon() {
  return (
    <svg className="sign__scroll" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.2 4.6h10.6c1.3 0 2.2 1 2.2 2.2v10.6c0 1.2.9 2 2 2H8.4c-1.2 0-2.2-.9-2.2-2.1V4.6z" />
      <path d="M6.2 4.6C5 4.6 4 5.5 4 6.8v1.6h2.2" />
      <path d="M9.6 9h6M9.6 12.4h6" />
    </svg>
  );
}

function useSnapshot(meta: WorldMeta | null): { snap: string | null; hero: string | null } {
  const { store } = useServices();
  const [urls, setUrls] = useState<{ snap: string | null; hero: string | null }>({ snap: null, hero: null });
  const snapRef = meta?.snapshot ?? null;
  const heroId = meta?.hero ?? null;
  useEffect(() => {
    let live = true;
    void (async () => {
      const snap = snapRef ? await store.blobs.url(snapRef).catch(() => null) : null;
      let hero: string | null = null;
      if (!snap && heroId) {
        const rec = await store.art.get(heroId).catch(() => null);
        hero = rec?.export ? await store.blobs.url(rec.export.sticker).catch(() => null) : null;
      }
      if (live) setUrls({ snap, hero });
    })();
    return () => {
      live = false;
    };
  }, [snapRef, heroId, store]);
  return urls;
}

const LONG_PRESS_MS = 550;

export function WorldSign({ source, x, top, legs, index, focused, now, onFocus, onKeyDown, onOpen, onMenu, linkRef }: WorldSignProps) {
  const meta = source.kind === 'world' ? source.meta : null;
  const info = source.kind === 'starter' ? source.info : null;
  const { snap, hero } = useSnapshot(meta);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);
  const anchor = useRef<HTMLAnchorElement | null>(null);

  const route: Route = meta ? { name: 'world', id: meta.id } : { name: 'starter', id: (info?.id ?? 'moon-king') as StarterId };
  const title = meta ? meta.title : (info?.title ?? '');
  const label = meta ? t('home.signOpen', { title, edited: editedWords(meta.updatedAt, now) }) : t('home.signOpenStarter', { title, genre: info?.genre ?? '' });

  const startPress = (e: PointerEvent<HTMLAnchorElement>) => {
    if (!onMenu || e.button !== 0) return;
    const el = e.currentTarget;
    const timer = window.setTimeout(() => {
      if (press.current) press.current.fired = true;
      onMenu(el);
    }, LONG_PRESS_MS);
    press.current = { timer, fired: false };
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  return (
    <li className="trail-stop trail-stop--sign" style={{ left: x, top: `calc(100% - 768px + ${top}px)`, ['--legs' as string]: `${legs}px`, ['--i' as string]: index } as CSSProperties}>
      <a
        ref={(el) => {
          anchor.current = el;
          linkRef(el);
        }}
        href={hrefOf(route)}
        className={cx('sign', meta && 'sign--world', meta?.assignment && 'sign--assignment')}
        tabIndex={focused ? 0 : -1}
        aria-label={label}
        data-testid="trail-sign"
        data-world={meta?.id}
        data-starter={info?.id}
        onFocus={() => onFocus(index)}
        onKeyDown={(e) => onKeyDown(e, index)}
        onClick={(e) => {
          if (press.current?.fired) {
            e.preventDefault();
            press.current = null;
            return;
          }
          onOpen(e, route, e.currentTarget);
        }}
        onContextMenu={(e) => {
          if (!onMenu) return;
          e.preventDefault();
          onMenu(e.currentTarget);
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
      >
        <span className="sign__bracket" aria-hidden="true">
          <BracketLantern />
        </span>
        <span className="sign__frame" aria-hidden="true">
          {snap ? (
            <img src={snap} alt="" draggable={false} />
          ) : info ? (
            info.sign ? <img src={info.sign} alt="" draggable={false} /> : <SeedScene seed={info.id as StarterId} pose={null} ghosts={false} />
          ) : hero ? (
            <span className="sign__hero">
              <img src={hero} alt="" draggable={false} />
            </span>
          ) : (
            <span className="sign__hero">
              <PlaceholderGlyph rig="biped" role="hero" size={64} />
            </span>
          )}
        </span>
        <span className="sign__legs" aria-hidden="true" />
        <span className="sign__tag">
          {meta?.assignment && <ScrollIcon />}
          <span className="sign__name">{title}</span>
          <small className={cx('sign__sub', info && 'sign__sub--caps')}>{meta ? <EditedLabel at={meta.updatedAt} now={now} /> : t('home.starterTag', { genre: info?.genre ?? '' })}</small>
        </span>
        {meta?.handedIn ? (
          <span className="sign__ribbon sign__ribbon--done">{t('home.handedIn')}</span>
        ) : meta?.assignment?.due ? (
          <span className="sign__ribbon">{t('home.dueRibbon', { due: meta.assignment.due })}</span>
        ) : null}
      </a>
    </li>
  );
}
