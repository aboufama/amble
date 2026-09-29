/**
 * The preview card (§2.10), 400 ms after each pen-up and never while the pen is down:
 * - **It already moves!** (on the bones, and for free drawings): the rig preview plays the parts drawn so
 *   far on their bones, with the undrawn bones as a constellation; Stand, Walk, Jump and Ouch.
 * - **In your world** (a cast member of a world): the running world, paused, in the `desk-preview` slot. The
 *   Desk swaps the drawing in and `step(0)` draws one frame, so the student sees it at its real size in its
 *   real place; **▶ Try it** plays 5 s. On leaving, the world gets its saved drawing back (Bring to life
 *   swaps the new one in itself).
 * Things with no bones show as their picture on the ground.
 */
import { useEffect, useRef, useState } from 'react';
import { usePlayerSlot } from '../../app/player/slots';
import { playerPrefsFrom } from '../../app/player/prefs';
import { isSupersededLoad, type PlayerHost } from '../../app/player/host';
import type { DrawnArt } from '../../cores/play';
import { createRigPreview, type RigPreview } from '../../cores/rig';
import type { DeskArt, DeskController, DeskState } from '../../draw/deskController';
import type { DeskSetup } from '../../draw/load';
import { drawnArtOf, previewRig, type PreviewRig } from '../../draw/preview';
import { t } from '../../i18n';
import type { CodeFile } from '../../model/types';
import type { Store } from '../../store/api';
import { getState, useStore } from '../../state/store';
import { useReducedMotion } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { Icon } from '../../ui/icons';
import { toInitMessage } from '../../world/init';
import { factText } from './RequestNote';
import { requestFacts } from '../../draw/request';

type View = 'moves' | 'world';

const MOVES = [
  { clip: 'idle', label: 'draw.move_idle' },
  { clip: 'walk', label: 'draw.move_walk' },
  { clip: 'jump', label: 'draw.move_jump' },
  { clip: 'hurt', label: 'draw.move_hurt' },
] as const;

const TRY_MS = 5000;
/** How long after the world moves into the preview's slot it is stepped once to fit it. */
const SETTLE_MS = 150;

/** The bones each preview export gets (one worker call per drawing, shared by both views). */
function useRigged(ctrl: DeskController, s: DeskState): { art: DeskArt | null; rigged: PreviewRig | null } {
  const [out, setOut] = useState<{ art: DeskArt | null; rigged: PreviewRig | null }>({ art: null, rigged: null });
  const starPose = s.starPose && s.guides;
  useEffect(() => {
    let seq = 0;
    return ctrl.watchArt((art) => {
      const mine = ++seq;
      if (!art) return setOut({ art: null, rigged: null });
      void previewRig(art, ctrl.request, ctrl.template(), ctrl.rigHints().guideHints).then((rigged) => {
        if (mine === seq) setOut({ art, rigged });
      });
    });
    // The star pose, the kind and the facing change which bones Freehand rigs with.
  }, [ctrl, starPose, s.kind, s.facing]);
  return out;
}

function MovesView({ ctrl, art, rigged, bones, still, hold }: { ctrl: DeskController; art: DeskArt | null; rigged: PreviewRig | null; bones: boolean; still: boolean; hold: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<RigPreview | null>(null);
  const reduced = useReducedMotion();
  const [clip, setClip] = useState<string>(reduced ? 'idle' : 'walk');
  const clipRef = useRef(clip);
  clipRef.current = clip;

  // The canvas matches its box in device pixels.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      preview.current?.setOptions({ height: c.height * 0.62 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || still) return;
    const p = createRigPreview(c, { ground: 0.84, height: c.height * 0.62, background: null, bones: bones ? { look: 'stars', width: 2, joint: 3, glow: 6 } : false, autoplay: !reduced });
    preview.current = p;
    return () => {
      p.destroy();
      preview.current = null;
    };
  }, [bones, reduced, still]);

  useEffect(() => {
    const p = preview.current;
    if (!p || !art || !rigged?.rig) return;
    void p.load(art.flat, rigged.rig, rigged.layers ?? undefined).then(() => {
      if (reduced && clipRef.current === 'idle') p.pose('idle', 0);
      else p.play(clipRef.current);
    }, () => undefined);
  }, [art, rigged, reduced]);

  // A still picture: things with no bones (or while the bones are being found).
  useEffect(() => {
    const c = canvas.current;
    if (!c || !art || (!still && rigged?.rig)) return;
    let live = true;
    void createImageBitmap(art.flat).then((bmp) => {
      const ctx = c.getContext('2d');
      if (!live || !ctx) return bmp.close();
      ctx.clearRect(0, 0, c.width, c.height);
      const k = Math.min((c.width * 0.8) / bmp.width, (c.height * 0.7) / bmp.height);
      const w = bmp.width * k;
      const h = bmp.height * k;
      ctx.drawImage(bmp, (c.width - w) / 2, c.height * 0.84 - h, w, h);
      bmp.close();
    });
    return () => {
      live = false;
    };
  }, [art, rigged, still]);

  // Never while the pen is down.
  useEffect(
    () =>
      ctrl.onEvent((e) => {
        if (e.type !== 'pen') return;
        if (e.down) preview.current?.pause();
        else if (!reduced || clipRef.current !== 'idle') preview.current?.resume();
      }),
    [ctrl, reduced],
  );

  // Nor while Bring to life runs: its frames would hold up the export, the rig and the save on a slow
  // Chromebook, and the drawing is about to fly into the world anyway. Back to moving if it stopped short.
  const held = useRef(false);
  useEffect(() => {
    if (hold === held.current) return;
    held.current = hold;
    if (hold) preview.current?.pause();
    else if (!reduced || clipRef.current !== 'idle') preview.current?.resume();
  }, [hold, reduced]);

  const play = (c: string) => {
    setClip(c);
    preview.current?.play(c);
    preview.current?.resume();
  };

  return (
    <>
      <div className="preview__stage preview__stage--moves">
        <canvas ref={canvas} className="preview__canvas" aria-hidden="true" />
        {!art && <p className="preview__empty">{t('draw.previewEmpty')}</p>}
      </div>
      {!still && (
        <div className="preview__moves" role="group" aria-label={t('draw.previewMoves')}>
          {MOVES.map((m) => (
            <button key={m.clip} type="button" className={cx('preview__move', clip === m.clip && 'preview__move--on')} aria-pressed={clip === m.clip} onClick={() => play(m.clip)} disabled={!art}>
              {t(m.label)}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Whether the player is running this world (the World screen loaded it). */
function worldLoaded(player: PlayerHost, worldId: string): boolean {
  const s = getState().session;
  return s.world?.id === worldId && s.manifest !== null && player.manifest() !== null;
}

/** The drawing the world had before the Desk swapped in the one being drawn. */
async function savedArt(store: Store, setup: DeskSetup, key: string): Promise<DrawnArt | null> {
  const rec = await store.art.get(setup.artId).catch(() => null);
  const e = rec?.export;
  if (!e) return null;
  const image = await store.blobs.get(e.flat);
  if (!image) return null;
  const out: DrawnArt = { key, image };
  if (rec.rigData) out.rig = rec.rigData;
  const layers: Record<string, Blob> = {};
  for (const [name, p] of Object.entries(e.parts)) {
    const b = await store.blobs.get(p.blob);
    if (b) layers[`part:${name}`] = b;
  }
  if (Object.keys(layers).length) out.layers = layers;
  return out;
}

/** A world's code as one comparable string (a new copy of the same code must not reload the preview). */
function codeKey(code: readonly CodeFile[]): string {
  return code.map((f) => `${f.path}\u0000${f.source}`).join('\u0000\u0000');
}

function WorldView({ ctrl, setup, player, store, art, rigged, brought }: { ctrl: DeskController; setup: DeskSetup; player: PlayerHost; store: Store; art: DeskArt | null; rigged: PreviewRig | null; brought: () => boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const key = setup.request.key ?? '';
  const world = setup.world;
  const [ready, setReady] = useState(false);
  const [trying, setTrying] = useState(false);
  const swapped = useRef(false);
  const tryTimer = useRef(0);
  // A plan's build can land while the student draws: the preview then plays the real game, not the Warm-up.
  // The open world's code when the world screen has it, else the stored world's newest code.
  const liveCode = useStore((s) => (world && s.session.world?.id === world.id ? s.session.world.code : null));
  /** undefined until the stored world has been read (the build may have landed before this view opened). */
  const [storedCode, setStoredCode] = useState<readonly CodeFile[] | null | undefined>(undefined);
  useEffect(() => {
    if (!world) return;
    let live = true;
    const read = () =>
      void store.worlds
        .get(world.id)
        .then((w) => live && setStoredCode(w?.code ?? null))
        .catch(() => live && setStoredCode(null));
    read();
    const off = store.onChange((e) => {
      if (e.worlds?.includes(world.id)) read();
    });
    return () => {
      live = false;
      off();
    };
  }, [store, world]);
  const code = liveCode ?? (storedCode === undefined ? null : (storedCode ?? world?.code ?? null));
  const shownKey = code ? codeKey(code) : '';
  /** The code the preview's game runs ('' until known). */
  const running = useRef('');

  // The world, paused. Loaded here when the Desk was opened straight from a link, or when its code changed
  // (declared before the slot, so on the way out the game resumes while still in view, and the player
  // pauses it as it hides).
  useEffect(() => {
    if (!world || !code) return;
    let live = true;
    // Paused only once a game is up (a game paused while it loads never shows its first frame). Once the
    // game's frame has moved into the small slot, one step lets the paused game fit itself to it.
    let settle = 0;
    const pauseSoon = () => {
      player.pause();
      setReady(true);
      settle = window.setTimeout(() => {
        if (live) player.step(1);
      }, SETTLE_MS);
    };
    // Already running this code: the preview's own game, or the world screen's game it came from.
    if (running.current === shownKey || (!running.current && worldLoaded(player, world.id))) {
      running.current = shownKey;
      pauseSoon();
    } else {
      setReady(false);
      void (async () => {
        const init = await toInitMessage({ ...world, code: [...code] }, { mode: 'play', prefs: playerPrefsFrom(getState().prefs) });
        await player.load(init);
        running.current = shownKey;
        if (live) pauseSoon();
      })().catch((err: unknown) => {
        if (!isSupersededLoad(err)) console.warn('The world preview could not start:', err);
      });
    }
    return () => {
      live = false;
      clearTimeout(settle);
      clearTimeout(tryTimer.current);
      // The world gets its saved drawing back unless Bring to life swapped the new one in.
      if (swapped.current && !brought())
        void savedArt(store, setup, key).then((a) => (a ? player.swapArt(a) : player.clearArt(key)), () => player.clearArt(key));
      player.resume();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, world, shownKey]);
  usePlayerSlot('desk-preview', slot);

  // The slot changes size (a window resize, the touch layout): one step refits the paused game.
  useEffect(() => {
    const el = slot.current;
    if (!el || !ready) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => player.step(1), SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [player, ready]);

  // Each new drawing goes into the world; one frame shows it.
  useEffect(() => {
    if (!ready || !art || !key) return;
    if (ctrl.request.kind === 'character' && ctrl.request.rig !== 'none' && !rigged) return;
    player.swapArt(drawnArtOf(key, art, rigged ?? { rig: null, layers: null }));
    swapped.current = true;
    player.step(0);
  }, [ready, art, rigged, key, player, ctrl]);

  // Never while the pen is down.
  useEffect(
    () =>
      ctrl.onEvent((e) => {
        if (e.type === 'pen' && e.down && trying) {
          clearTimeout(tryTimer.current);
          player.pause();
          setTrying(false);
        }
      }),
    [ctrl, player, trying],
  );

  const tryIt = () => {
    clearTimeout(tryTimer.current);
    setTrying(true);
    player.resume();
    tryTimer.current = window.setTimeout(() => {
      player.pause();
      setTrying(false);
    }, TRY_MS);
  };

  const moves = requestFacts(ctrl.request).find((f) => f.key === 'moves');
  // The game's frame sits over the slot, so the bar goes under it, not on it.
  return (
    <>
      <div className="preview__stage preview__stage--world">
        <div ref={slot} className="preview__slot" data-testid="desk-preview-slot" aria-label={t('draw.inYourWorld')} role="img" />
        {!ready && <p className="preview__empty">{t('draw.previewLoading')}</p>}
      </div>
      <div className="preview__bar">
        <span className="preview__tag">{moves ? factText(moves) : t('draw.updatesWhenLift')}</span>
        <button type="button" className="preview__try" onClick={tryIt} disabled={!ready || trying}>
          <Icon name="play" size={16} />
          <span>{t('draw.tryIt')}</span>
        </button>
      </div>
    </>
  );
}

export interface PreviewCardProps {
  ctrl: DeskController;
  s: DeskState;
  setup: DeskSetup;
  player: PlayerHost;
  store: Store;
  /** Bring to life swapped the finished drawing in (the card leaves it there). */
  brought(): boolean;
  /** Bring to life is running: the moves hold still (their frames would slow the export, rig and save). */
  bringing?: boolean;
}

export function PreviewCard({ ctrl, s, setup, player, store, brought, bringing = false }: PreviewCardProps) {
  const r = ctrl.request;
  const inWorld = !!setup.world && !!r.key;
  const rigged = r.kind === 'character' && r.rig !== 'none';
  // The card follows the drawing (moves on the bones, the world in Freehand) until the student picks.
  const [picked, setPicked] = useState<View | null>(null);
  const { art, rigged: bones } = useRigged(ctrl, s);
  const both = inWorld && rigged;
  const shown: View = !inWorld ? 'moves' : !rigged ? 'world' : (picked ?? (s.mode === 'bones' ? 'moves' : 'world'));

  const total = s.steps.reduce((n, st) => n + st.parts.length, 0);
  const title = shown === 'world' ? t('draw.inYourWorld') : rigged ? t('draw.itMoves') : t('draw.previewMoves');
  const progress = shown === 'moves' && s.mode === 'bones' ? t('draw.partsDrawn', { n: s.drawn.length, max: total }) : '';

  return (
    <section className="preview" aria-labelledby="desk-preview">
      <div className="preview__head">
        <h2 id="desk-preview" className="preview__title">
          <Icon name={shown === 'world' ? 'eye' : 'play'} size={16} />
          {title}
        </h2>
        {both ? (
          <button type="button" className="preview__switch" onClick={() => setPicked(shown === 'world' ? 'moves' : 'world')}>
            <Icon name={shown === 'world' ? 'bones' : 'eye'} size={14} />
            <span>{shown === 'world' ? t('draw.previewMovesShort') : t('draw.previewWorldShort')}</span>
          </button>
        ) : (
          shown === 'world' && <span className="side__meta">{t('draw.updatesWhenLift')}</span>
        )}
      </div>
      <div className="preview__body">
        {shown === 'world' ? (
          <WorldView ctrl={ctrl} setup={setup} player={player} store={store} art={art} rigged={bones} brought={brought} />
        ) : (
          <MovesView ctrl={ctrl} art={art} rigged={bones} bones={s.mode === 'bones'} still={!rigged} hold={bringing} />
        )}
        {progress && <span className="preview__progress">{progress}</span>}
      </div>
    </section>
  );
}
