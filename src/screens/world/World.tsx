/**
 * `#/w/<id>` the world (§2.6, §2.7): the running game at the centre with Play | Change, the Cast line under
 * it, and the notebook (Ask, Dials | Twists in Change mode, Footsteps) beside it. The game never stops for
 * AI work. Tapping a "just bones" member lifts it onto the Desk; Bring to life brings it back with the
 * come-alive flight, and the game goes on where it paused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useCommand } from '../../app/keys';
import { usePlayerSlot } from '../../app/player/slots';
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { withViewTransition } from '../../app/transitions';
import { midSentence, t } from '../../i18n';
import type { CastMember } from '../../model/types';
import { announce, showToast } from '../../state/app';
import { effectiveAiMode } from '../../state/config';
import { markSeen } from '../../state/prefs';
import { confirmUser } from '../../ui/dialogs';
import { runAsk } from '../../world/ask';
import { loadGame, patchSession, setComeAlive, setMode, updateWorld } from '../../state/session';
import { getState, useStore } from '../../state/store';
import { Sheet } from '../../ui/components';
import { useReducedMotion } from '../../ui/a11y';
import { playUiSound } from '../../ui/sounds';
import { flyComeAlive, liftCard } from '../../world/comeAlive';
import { readsPointer, WorldController } from '../../world/controller';
import { installKeyForwarding } from '../../world/keys';
import { boxOfKey, type Box } from '../../world/objects';
import { FootstepsPanel } from '../footsteps/FootstepsPanel';
import { AddSomeone, takePendingAdd } from './AddSomeone';
import { AskCard } from './AskCard';
import { CastLine } from './CastLine';
import { ControlsRow } from './ControlsRow';
import { ControlsSheet } from './ControlsSheet';
import { DialsCard } from './DialsCard';
import { useLayout, useRect } from './hooks';
import { ProblemsSheet } from './ProblemCard';
import { SoundsSheet } from './SoundsSheet';
import { WorldTopBar } from './TopBar';
import { WorldInfo } from './WorldInfo';
import type { SheetName } from './WorldMenu';
import { WorldView } from './WorldView';
import './world.css';

function boxOf(r: DOMRect | { left: number; top: number; width: number; height: number }): Box {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Where the Desk's sheet will be, roughly (the lift card grows to it). */
function deskBox(): Box {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return { x: Math.round(w * 0.08), y: 76, w: Math.round(w * 0.62), h: Math.max(200, h - 112) };
}

export function World({ route }: { route: RouteOf<'world'> }) {
  const { player, ai } = useServices();
  const frameRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const controller = useRef<WorldController | null>(null);
  const world = useStore((s) => (s.session.world?.id === route.id ? s.session.world : null));
  const mode = useStore((s) => s.session.mode);
  const layout = useLayout();
  const reduced = useReducedMotion();
  const frame = useRect(frameRef, !!world);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [adding, setAdding] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const lifting = useRef(false);
  // The slot exists once the world is open (the screen renders a plain frame until then).
  usePlayerSlot('world', slotRef, !!world);

  // ---------------------------------------------------------------- the lift onto the Desk

  const lift = useCallback(
    async (member: CastMember, from?: HTMLElement | DOMRect | Box) => {
      const w = getState().session.world;
      if (!w || lifting.current) return;
      lifting.current = true;
      if (!getState().prefs.seen.ghostTip) markSeen('ghostTip');
      controller.current?.pauseForEditor();
      playUiSound('lift');
      announce(t('world.lifting', { name: midSentence(member.name) }));
      const start: Box = !from
        ? (() => {
            const f = frameRef.current?.getBoundingClientRect();
            const b = boxOfKey(getState().session.objects, member.key);
            return f && b ? { x: f.left + b.x, y: f.top + b.y, w: b.w, h: b.h } : deskBox();
          })()
        : from instanceof HTMLElement
          ? boxOf(from.getBoundingClientRect())
          : from instanceof DOMRect
            ? boxOf(from)
            : from;
      try {
        const card = await liftCard({ from: start, to: deskBox(), reduced });
        const go = () => navigate({ name: 'draw', worldId: w.id, key: member.key }, { transition: false });
        withViewTransition(() => {
          card?.remove();
          flushSync(go);
        });
      } finally {
        lifting.current = false;
      }
    },
    [reduced],
  );

  // ---------------------------------------------------------------- the game's controller

  useEffect(() => {
    let live = true;
    /** Still this screen: mounted, and the route is still this world (the student may leave while it starts). */
    const here = () => {
      const r = getState().app.route;
      return live && r.name === 'world' && r.id === route.id;
    };
    const c = new WorldController(route.id, {
      onLift: (key, rect) => {
        const member = getState().session.cast.find((m) => m.key === key);
        const f = frameRef.current?.getBoundingClientRect();
        if (member) void lift(member, f ? { x: f.left + rect.x, y: f.top + rect.y, w: rect.w, h: rect.h } : undefined);
      },
      onEscape: () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else frameRef.current?.querySelector<HTMLElement>('#game')?.focus({ preventScroll: true });
      },
      // Nothing to show: never a loading screen with no way out.
      onMissing: () => {
        showToast(t('world.notFound'));
        navigate({ name: 'trail', view: 'trail' }, { replace: true });
      },
    });
    controller.current = c;
    // Left before it started: no flight over the next screen, and the hidden game stays paused. The flight
    // (and the Add someone that waits for it) comes the next time this world shows.
    void c.start().then(() => {
      if (here()) void afterStart(here);
    });
    return () => {
      live = false;
      c.stop();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id]);

  /** Back from the Desk: the come-alive flight, then the game goes on (while `here()`: still this world's screen). */
  const afterStart = useCallback(async (here: () => boolean) => {
    const s = getState().session;
    const alive = s.comeAlive;
    if (!alive || !s.world) {
      if (s.world && s.ready && s.mode === 'play') player.resume();
      return;
    }
    setComeAlive(null);
    const items = alive.key ? ((await controller.current?.fetchObjects(700)) ?? null) : null;
    if (!here()) {
      // Gone before it could fly: it flies the next time this world shows.
      if (!getState().session.comeAlive && getState().session.world?.id === s.world.id) setComeAlive(alive);
      return;
    }
    const f = frameRef.current?.getBoundingClientRect();
    const inWorld = alive.key && items && f ? boxOfKey(items, alive.key) : null;
    const target = inWorld && f ? { x: f.left + inWorld.x, y: f.top + inWorld.y, w: inWorld.w, h: inWorld.h } : null;
    const card = alive.key ? document.querySelector<HTMLElement>(`[data-testid="cast-card-${alive.key}"]`) : null;
    const fallback = card ? boxOf(card.getBoundingClientRect()) : f ? { x: f.left + f.width / 2 - 40, y: f.top + f.height / 2 - 40, w: 80, h: 80 } : { x: 0, y: 0, w: 80, h: 80 };
    const name = alive.key ? (getState().session.cast.find((m) => m.key === alive.key)?.name ?? '') : '';
    playUiSound('alive');
    await flyComeAlive({
      sticker: alive.sticker,
      from: boxOf(alive.from),
      target,
      fallback,
      reduced,
      onCheer: () => {
        if (!here()) return;
        playUiSound('drop');
        player.resume();
        if (alive.key) player.celebrate(alive.key);
      },
    });
    if (!here()) return;
    if (name) announce(t('world.cameAlive', { name }));
    await afterAdd(s.world.id, alive.key, alive.artId);
  }, [player, reduced]);

  /** Someone added with Add someone came alive: ask the AI helper to add them, or offer a spare slot. */
  const afterAdd = useCallback(
    async (worldId: string, key: string | null, artId: string) => {
      const added = takePendingAdd(worldId, key);
      if (!added) return;
      const w = getState().session.world;
      if (ai.status() === 'ready' && effectiveAiMode(w?.assignment ?? null) === 'on') {
        const words = added.what ? t('world.addRequest', { name: added.name, role: added.roleWord, what: added.what }) : t('world.addRequestPlain', { name: added.name, role: added.roleWord });
        void runAsk('change', words);
        return;
      }
      const spare = getState().session.cast.find((m) => m.status === 'spare');
      if (!spare) return;
      const use = await confirmUser({
        title: t('world.addSpareOffer', { name: spare.name, about: spare.about }),
        ok: t('world.addUseSpare', { name: spare.name }),
        cancel: t('world.addNoThanks'),
      });
      if (!use) return;
      const next = updateWorld((w) => {
        const slot = w.cast[spare.key] ?? { key: spare.key, art: null, madeBy: null, extra: null, laterUntil: 0 };
        w.cast[spare.key] = { ...slot, art: artId, madeBy: 'student' };
        delete w.cast[added.key];
      });
      if (next) void loadGame(next, { autostart: true });
    },
    [ai],
  );

  const locate = useCallback(async (key: string) => {
    const items = await controller.current?.fetchObjects(700);
    return items ? boxOfKey(items, key) : null;
  }, []);

  // ---------------------------------------------------------------- keys

  useEffect(
    () =>
      installKeyForwarding(player, () => ({
        mode: getState().session.mode,
        modal: !!document.querySelector('dialog[open]') || lifting.current,
      })),
    [player],
  );

  const toggleMode = useCallback(
    (next?: 'play' | 'change') => {
      const target = next ?? (getState().session.mode === 'play' ? 'change' : 'play');
      if (target === 'change' && document.fullscreenElement) return false;
      playUiSound(target === 'change' ? 'toggleOn' : 'toggleOff');
      setMode(target);
      return true;
    },
    [],
  );

  const restart = useCallback(() => {
    const s = getState().session;
    if (s.stopped && s.world) {
      void loadGame(s.world);
      return;
    }
    if (s.mode === 'change') setMode('play');
    patchSession({ request: null });
    player.restartLevel();
  }, [player]);

  const reload = useCallback(() => {
    const w = getState().session.world;
    if (w) void loadGame(w);
  }, []);

  const goFullscreen = useCallback(async () => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (getState().session.mode === 'change') setMode('play');
    try {
      await player.fullscreen(el);
    } catch {
      showToast(t('world.fullscreenFailed'));
    }
  }, [player]);

  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const drawNext = useCallback(() => {
    const next = getState().session.cast.find((m) => m.status === 'needed');
    if (!next) return false;
    const card = document.querySelector<HTMLElement>(`[data-testid="cast-card-${next.key}"]`);
    void lift(next, card ?? undefined);
    return true;
  }, [lift]);

  useCommand('playChange', () => toggleMode());
  useCommand('restart', () => {
    restart();
  });
  useCommand('fullscreen', () => {
    void goFullscreen();
  });
  useCommand('drawNext', drawNext);

  if (!world) {
    return <div className="screen screen--loading world-screen" data-testid="screen-world" aria-busy="true" />;
  }

  const pointerGame = readsPointer(world.code);
  const small = layout === 'small';
  const notebook = (
    <>
      <AskCard world={world} />
      {mode === 'change' && <DialsCard />}
      <div className="notebook__steps">
        <FootstepsPanel worldId={world.id} compact={layout !== 'full'} />
      </div>
    </>
  );

  return (
    <div className="screen world-screen" data-testid="screen-world" data-mode={mode}>
      <WorldTopBar world={world} onOpen={setSheet} />
      <main id="main" tabIndex={-1} className="world-main">
        <WorldView
          ref={frameRef}
          world={world}
          slotRef={slotRef}
          frame={frame}
          fullscreen={fullscreen}
          pointerGame={pointerGame}
          onRestart={restart}
          onReload={reload}
          onExitFullscreen={() => void document.exitFullscreen().catch(() => undefined)}
          onDraw={(m, from) => void lift(m, from)}
          onBones={(m) => navigate({ name: 'bones', worldId: world.id, key: m.key })}
          locate={locate}
        />
        <ControlsRow
          world={world}
          fullscreen={fullscreen}
          onMode={(m) => toggleMode(m)}
          onRestart={restart}
          onFullscreen={() => void goFullscreen()}
          onDrawer={() => setDrawer(true)}
        />
        <CastLine world={world} onDraw={(m, el) => void lift(m, el)} onAdd={() => setAdding(true)} />
      </main>
      {small ? (
        <Sheet open={drawer} onClose={() => setDrawer(false)} title={t('world.askAndFootsteps')} titleHidden side="right" className="notebook-drawer">
          <div className="notebook notebook--drawer">{notebook}</div>
        </Sheet>
      ) : (
        <aside className="notebook" aria-label={t('world.askTitle')}>
          {notebook}
        </aside>
      )}
      <SoundsSheet open={sheet === 'sounds'} world={world} onClose={() => setSheet(null)} />
      <ControlsSheet open={sheet === 'controls'} world={world} onClose={() => setSheet(null)} />
      <ProblemsSheet open={sheet === 'problems'} onClose={() => setSheet(null)} />
      <WorldInfo open={sheet === 'info'} world={world} onClose={() => setSheet(null)} />
      <AddSomeone open={adding} world={world} onClose={() => setAdding(false)} onDraw={(m) => void lift(m)} />
    </div>
  );
}
