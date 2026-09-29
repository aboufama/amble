/**
 * `#/trail` the Trail (§2.4; spec-mocks/03-trail.png): home for returning students. A night landscape
 * with a lit path where every world is a signboard and the student's drawings walk between them; the
 * student's worlds first, then the starter worlds. Also its List view (`#/trail/list`) and Lost and found
 * (`#/trail/lost`).
 *
 * The trail scrolls sideways (wheel, trackpad, ◂ ▸, arrow keys on the signs); the hills drift at 0.3x.
 * Signs are a list of links with roving focus; Shift+F10 (or a long press) opens a world sign's menu.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import { Link } from '../../app/Link';
import { navigate } from '../../app/router';
import type { Route, RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { transitionName } from '../../app/transitions';
import { t } from '../../i18n';
import { playHomeSound } from '../../home/sounds';
import { sweepStarterCopies } from '../../home/starterCopies';
import {
  DESIGN_H,
  latestCharacter,
  legHeight,
  pathTop,
  pendingAssignment,
  placeStops,
  restingCharacters,
  signStops,
  signTop,
  trailStops,
  walkerFeet,
  type PlacedStop,
} from '../../home/trailData';
import type { ArtId, WorldMeta } from '../../model/types';
import { announce } from '../../state/app';
import { refreshLibrary } from '../../state/library';
import { setPrefs } from '../../state/prefs';
import { setComeAlive } from '../../state/session';
import { useStore } from '../../state/store';
import { useReducedMotion } from '../../ui/a11y';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';
import { LegacyCard } from '../files/LegacyCard';
import { StorageBanner } from '../files/StorageBanner';
import { SpaceChip, UpdatedChip } from '../files/TrailChips';
import { setLegacy } from '../../state/library';
import { AssignmentNote } from './AssignmentNote';
import { HomeHeader } from './HomeHeader';
import { NightSky, ParallaxHills, TrailGround } from './Landscape';
import { LampSpot } from './LampSpot';
import { ListView } from './ListView';
import { LostAndFound } from './LostAndFound';
import { SignMenu } from './SignMenu';
import { TrailNav } from './TrailNav';
import { useStarterWalkers } from './useStarterWalkers';
import { useStrips, type WalkerArt } from './useStrips';
import { Walker } from './Walker';
import { WorldSign } from './WorldSign';
import './trail.css';

const LIT_KEY = 'amble.trailLit';
const WALKER_H = 62;
const LAMP_CHARACTER_H = 118;
const NOTE_ROOM = 190;

function firstLoadThisSession(): boolean {
  try {
    if (sessionStorage.getItem(LIT_KEY)) return false;
    sessionStorage.setItem(LIT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export function Trail({ route }: { route: RouteOf<'trail'> }) {
  const { store } = useServices();
  const reduced = useReducedMotion();
  const paused = useStore((s) => s.prefs.trailPaused);
  const [firstLoad] = useState(firstLoadThisSession);
  const still = reduced || paused;

  useEffect(() => {
    let live = true;
    void (async () => {
      await refreshLibrary(store);
      const metas = await store.worlds.list().catch(() => []);
      if (live && (await sweepStarterCopies(metas).catch(() => false))) await refreshLibrary(store);
    })();
    return () => {
      live = false;
    };
  }, [store]);

  useEffect(() => {
    if (firstLoad && route.view === 'trail') playHomeSound('chime');
  }, [firstLoad, route.view]);

  const extra = (
    <>
      <UpdatedChip />
      <SpaceChip />
    </>
  );

  return (
    <div className={cx('trail', still && 'trail--still', firstLoad && 'trail--first-load', `trail--${route.view}`)} data-testid="screen-trail" data-view={route.view}>
      <NightSky />
      <HomeHeader pulse={firstLoad && !reduced} extra={extra} />
      {route.view === 'trail' ? (
        <TrailScene still={still} lit={firstLoad && !reduced} />
      ) : (
        <main id="main" tabIndex={-1} className="trail__main trail__main--sheet">
          <StorageBanner />
          {route.view === 'list' ? <ListView /> : <LostAndFound />}
        </main>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the scene

interface SceneProps {
  still: boolean;
  lit: boolean;
}

function TrailScene({ still, lit }: SceneProps) {
  const { starters } = useServices();
  const worlds = useStore((s) => s.library.worlds);
  const characters = useStore((s) => s.library.characters);
  const loaded = useStore((s) => s.library.loaded);
  const legacy = useStore((s) => s.library.legacy);
  const shared = useStore((s) => s.config.shared || (s.config.ai?.sharedDevice ?? false));
  const classAsg = useStore((s) => s.config.classLink?.asg ?? null);
  const comeAlive = useStore((s) => s.session.comeAlive);
  const paused = useStore((s) => s.prefs.trailPaused);

  const scroller = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const links = useRef<Array<HTMLAnchorElement | null>>([]);
  const [focus, setFocus] = useState(0);
  const [minTop, setMinTop] = useState(500);
  const [edges, setEdges] = useState({ left: false, right: true });
  const [menu, setMenu] = useState<{ meta: WorldMeta; el: HTMLElement } | null>(null);
  const [landing, setLanding] = useState<{ id: ArtId; name: string } | null>(null);
  const [flight, setFlight] = useState<{ sticker: string; from: DOMRect; to: DOMRect } | null>(null);

  const starterList = useMemo(() => starters.list(), [starters]);
  const hasCharacters = characters.length > 0;
  const latest = latestCharacter(characters);
  const resting = useMemo(() => restingCharacters(characters, worlds), [characters, worlds]);
  const assignment = pendingAssignment(classAsg, worlds);
  const stops = useMemo(() => trailStops({ worlds, starters: starterList, hasCharacters, resting: resting.slice(0, 3).map((c) => c.id) }), [worlds, hasCharacters, resting, starterList]);
  const { placed, width } = useMemo(() => placeStops(stops, { noteRoom: assignment ? NOTE_ROOM : 0 }), [stops, assignment]);
  const signs = signStops(stops);
  const now = Date.now();

  // The hero copy must stay readable when the trail scrolls under it: signs never rise above it.
  useLayoutEffect(() => {
    const el = copy.current;
    if (!el) return;
    const measure = () => {
      const bottom = el.getBoundingClientRect().bottom;
      setMinTop(Math.round(bottom + 18 - (window.innerHeight - DESIGN_H)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hasCharacters]);

  // ◂ ▸ know when the trail has more to show.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [width]);

  // A drawing brought to life on the Desk flies to the lamppost (§2.17), then "Give {name} a world."
  useEffect(() => {
    if (!comeAlive || comeAlive.key !== null) return;
    const target = document.querySelector<HTMLElement>('[data-testid="lamp-spot"] .lamp__character, [data-testid="lamp-spot"]');
    const name = characters.find((c) => c.id === comeAlive.artId)?.name ?? '';
    setComeAlive(null);
    if (target && !still) {
      const r = target.getBoundingClientRect();
      const to = new DOMRect(r.x + r.width / 2 - 60, r.bottom - 150, 120, 130);
      setFlight({ sticker: comeAlive.sticker, from: comeAlive.from, to });
      window.setTimeout(() => setFlight(null), 900);
    }
    setLanding({ id: comeAlive.artId, name });
    if (name) announce(t('home.landed', { name }));
  }, [comeAlive, characters, still]);

  const scrollBySigns = (dir: 1 | -1) => {
    scroller.current?.scrollBy({ left: dir * 3 * 250, behavior: still ? 'auto' : 'smooth' });
  };

  const focusSign = useCallback(
    (i: number) => {
      const el = links.current[i];
      if (!el) return;
      setFocus(i);
      el.focus({ preventScroll: true });
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: still ? 'auto' : 'smooth' });
      playUiSound('tok');
    },
    [still],
  );

  const onSignKey = (e: KeyboardEvent<HTMLAnchorElement>, i: number) => {
    const last = signs.length - 1;
    const to = e.key === 'ArrowRight' ? Math.min(last, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to !== null) {
      e.preventDefault();
      focusSign(to);
      return;
    }
    const stop = signs[i];
    if (((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') && stop.kind === 'world') {
      e.preventDefault();
      setMenu({ meta: stop.meta, el: e.currentTarget });
    }
  };

  const openSign = (e: MouseEvent<HTMLAnchorElement>, route: Route, el: HTMLAnchorElement) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (route.name === 'world') transitionName(el.querySelector<HTMLElement>('.sign__frame'), 'world-view');
    navigate(route);
  };

  const playFirst = () => {
    const i = signs.findIndex((s) => s.kind === 'starter');
    if (i >= 0) focusSign(i);
  };

  // Walkers: each world's hero (and one more), the resting characters at + New world, the starters'.
  const worldWalkerIds = useMemo(() => {
    const ids: ArtId[] = [];
    for (const s of stops) {
      if (s.kind === 'world') ids.push(...(s.meta.walkers.length ? s.meta.walkers : s.meta.hero ? [s.meta.hero] : []).slice(0, 2));
      if (s.kind === 'newWorld') ids.push(...s.resting);
    }
    return [...new Set(ids)];
  }, [stops]);
  const walkArts = useStrips(worldWalkerIds, 'walk');
  const lampIds = useMemo(() => (latest ? [latest.id] : []), [latest]);
  const idleArts = useStrips(lampIds, 'idle');
  const starterWalkers = useStarterWalkers(starterList);

  const placedLamp = placed.find((p) => p.stop.kind === 'lamp');
  const lampFeet = placedLamp ? Math.round(pathTop(placedLamp.cx) + 15) : 0;

  const walkerEls: ReactElement[] = [];
  const seen = new Set<ArtId>();
  const addWalker = (art: WalkerArt | undefined, p: PlacedStop, slot: number, k: number, onOpen?: () => void) => {
    if (!art) return;
    const feet = walkerFeet(p.cx, slot);
    walkerEls.push(
      <Walker
        key={`${p.stop.id}:${art.id}:${slot}`}
        id={art.id}
        name={art.name}
        strip={art.strip}
        still={art.still}
        x={feet.x}
        y={feet.y}
        height={WALKER_H}
        travel={90 + (k % 3) * 20}
        duration={24 + ((k * 7) % 17)}
        delay={-((k * 5.3) % 20)}
        focusable={!seen.has(art.id)}
        onOpen={onOpen}
      />,
    );
    seen.add(art.id);
  };
  placed.forEach((p, k) => {
    if (p.stop.kind === 'world') {
      const ids = (p.stop.meta.walkers.length ? p.stop.meta.walkers : p.stop.meta.hero ? [p.stop.meta.hero] : []).slice(0, 2);
      ids.forEach((id, slot) => addWalker(walkArts.get(id), p, slot, k + slot));
    } else if (p.stop.kind === 'newWorld') {
      p.stop.resting.forEach((id, slot) => addWalker(walkArts.get(id), p, slot % 2, k + slot));
    } else if (p.stop.kind === 'starter') {
      const id = p.stop.id;
      addWalker(starterWalkers.get(id), p, 0, k, () => navigate({ name: 'starter', id }));
    }
  });

  const lampArt = latest ? idleArts.get(latest.id) : undefined;
  const lampCharacter =
    latest && lampArt && placedLamp ? (
      <Walker
        id={latest.id}
        name={latest.name}
        strip={lampArt.strip}
        still={lampArt.still}
        x={placedLamp.cx - placedLamp.x}
        y={262}
        height={LAMP_CHARACTER_H}
        travel={0}
        duration={1}
        delay={0}
        idle
        focusable
        local
        className="lamp__character"
      />
    ) : null;

  let signIndex = -1;
  return (
    <main id="main" tabIndex={-1} className={cx('trail__main', loaded && 'trail__main--loaded')}>
      <div className="trail__banner">
        <StorageBanner />
      </div>
      <div ref={copy} className={cx('trail-copy', hasCharacters && 'trail-copy--back')}>
        {hasCharacters ? (
          <div className="trail-copy__back">
            <h1 className="trail-copy__welcome">{t('home.welcomeBack')}</h1>
            <Link to={{ name: 'new', hero: null, idea: false }} className="btn btn--lantern btn--h44" data-testid="new-world">
              <Icon name="plus" size={20} />
              <span className="btn__label">{t('home.newWorld')}</span>
            </Link>
            <Link to={{ name: 'drawFree', artId: 'new' }} className="btn btn--ghost btn--h44" data-testid="draw-character">
              <Icon name="draw" size={20} />
              <span className="btn__label">{t('home.drawCharacter')}</span>
            </Link>
          </div>
        ) : (
          <>
            <p className="trail-copy__eyebrow">{t('home.eyebrow')}</p>
            <h1 className="trail-copy__headline">
              <span>{t('home.headlineOne')}</span>
              <span className="trail-copy__alive">{t('home.headlineTwo')}</span>
            </h1>
            <p className="trail-copy__lede">
              {t('home.lede')} <b>{t('home.ledeBold')}</b>
            </p>
            <div className="trail-copy__ctas">
              <Link to={{ name: 'first' }} className="btn btn--lantern btn--h58" data-testid="draw-character">
                <Icon name="draw" size={24} />
                <span className="btn__label">{t('home.drawCharacter')}</span>
              </Link>
              <Button variant="ghost" size={58} icon="play" onClick={playFirst} data-testid="play-first">
                {t('home.playWorldFirst')}
              </Button>
            </div>
            <p className="trail-copy__trust">
              <Icon name="lock" size={18} />
              <span>{shared ? t('home.trustShared') : t('home.trustTrail')}</span>
            </p>
          </>
        )}
        {hasCharacters && shared && (
          <p className="trail-copy__trust">
            <Icon name="lock" size={18} />
            <span>{t('home.trustShared')}</span>
          </p>
        )}
        {legacy && <LegacyCard legacy={legacy} onDone={() => setLegacy(null)} />}
      </div>

      <ParallaxHills scroller={scroller} still={still} />
      <div
        ref={scroller}
        className="trail__scroller"
        aria-label={t('home.trailLabel')}
        onWheel={(e) => {
          const el = scroller.current;
          if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
        }}
      >
        <div className="trail__content" style={{ width } as CSSProperties}>
          <TrailGround width={width} pools={placed.filter((p) => p.stop.kind !== 'signpost').map((p) => ({ cx: p.cx, big: p.stop.kind === 'lamp' }))} />
          <div className={cx('trail__decor', lit && 'trail__decor--lit')}>
            {placed.map((p) => {
              if (p.stop.kind === 'signpost') {
                const top = Math.round(pathTop(p.cx) - 84);
                return (
                  <div key={p.stop.id} className="signpost" style={{ left: p.x + 20, top: `calc(100% - 768px + ${top}px)` }}>
                    <span className="signpost__plate">{t('home.starterWorlds')}</span>
                    <span className="signpost__post" aria-hidden="true" />
                  </div>
                );
              }
              if (p.stop.kind === 'newWorld') {
                const top = Math.round(pathTop(p.cx) - 96);
                return (
                  <div key={p.stop.id} className="signpost signpost--new" style={{ left: p.x + 10, top: `calc(100% - 768px + ${top}px)` }}>
                    <Link to={{ name: 'new', hero: null, idea: false }} className="signpost__plate signpost__plate--link">
                      <Icon name="plus" size={18} />
                      {t('home.newWorld')}
                    </Link>
                    <span className="signpost__post" aria-hidden="true" />
                  </div>
                );
              }
              if (p.stop.kind === 'lamp') {
                return (
                  <div key="lamp" className="lamp-wrap">
                    {assignment && <AssignmentNote assignment={assignment} left={p.x - NOTE_ROOM + 8} top={lampFeet - 250} />}
                    <LampSpot
                      x={p.x}
                      cx={p.cx}
                      feet={lampFeet}
                      empty={!latest}
                      breathing={!latest && !still}
                      character={lampCharacter}
                      give={landing}
                      lit={lit}
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
          <ul className="trail__signs" aria-label={t('home.signsLabel')}>
            {placed.map((p) => {
              if (p.stop.kind !== 'world' && p.stop.kind !== 'starter') return null;
              signIndex += 1;
              const i = signIndex;
              const top = signTop(p.cx, i, minTop);
              const stop = p.stop;
              return (
                <WorldSign
                  key={stop.id}
                  source={stop.kind === 'world' ? { kind: 'world', meta: stop.meta } : { kind: 'starter', info: stop.info }}
                  x={p.x}
                  top={top}
                  legs={legHeight(p.cx, top)}
                  index={i}
                  focused={i === Math.min(focus, signs.length - 1)}
                  now={now}
                  onFocus={setFocus}
                  onKeyDown={onSignKey}
                  onOpen={openSign}
                  onMenu={stop.kind === 'world' ? (el) => setMenu({ meta: stop.meta, el }) : undefined}
                  linkRef={(el) => {
                    links.current[i] = el;
                  }}
                />
              );
            })}
          </ul>
          <div className={cx('trail__walkers', paused && 'trail__walkers--paused')}>{walkerEls}</div>
        </div>
      </div>

      <TrailNav
        mine={worlds.filter((w) => w.putAwayAt === null).length}
        starters={starterList.length}
        paused={paused}
        canLeft={edges.left}
        canRight={edges.right}
        onLeft={() => scrollBySigns(-1)}
        onRight={() => scrollBySigns(1)}
        onList={() => {
          setPrefs({ trailView: 'list' });
          navigate({ name: 'trail', view: 'list' });
        }}
        onPause={() => setPrefs({ trailPaused: !paused })}
      />

      <SignMenu meta={menu?.meta ?? null} anchor={menu?.el ?? null} onClose={() => setMenu(null)} />

      {flight && (
        <img
          className="come-alive"
          src={flight.sticker}
          alt=""
          style={
            {
              ['--from-x' as string]: `${flight.from.x}px`,
              ['--from-y' as string]: `${flight.from.y}px`,
              ['--from-w' as string]: `${flight.from.width}px`,
              ['--to-x' as string]: `${flight.to.x}px`,
              ['--to-y' as string]: `${flight.to.y}px`,
              ['--to-w' as string]: `${flight.to.width}px`,
            } as CSSProperties
          }
        />
      )}
    </main>
  );
}

