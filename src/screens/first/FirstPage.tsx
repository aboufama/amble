/**
 * `#/first` the First page (§2.3): a sheet of cream paper taped over the night Trail. **"Draw a
 * creature."**, six marker caps, and **Bring it to life** once 1.5 % of the paper is inked: the doodle
 * is rigged as a blob in under a second and hops. Then the chips (kind, name) and **"Now give {name} a
 * world."** No AI, no menus, nothing to learn.
 *
 * The paper is a rotated sheet; the drawing surface and the alive stage sit inside it unrotated (the
 * art engine maps pointers in page coordinates), inset so the sheet's edges always cover them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { navigate } from '../../app/router';
import { useServices } from '../../app/services';
import { transitionName } from '../../app/transitions';
import { createArtSurface, newArtDoc, type ArtSurface } from '../../cores/art';
import { rigWorker, setFacing as setRigFacing, type CharacterKind, type RigData } from '../../cores/rig';
import { bringToLife } from '../../draw/api';
import { t } from '../../i18n';
import { createAssignmentWorld, openSeed } from '../../home/createWorld';
import { renderPose, type PoseImage } from '../../home/seedThumbs';
import type { ArtRecord, Facing, StarterId } from '../../model/types';
import { announce, showToast } from '../../state/app';
import { refreshLibrary } from '../../state/library';
import { markSeen } from '../../state/prefs';
import { openWorld, setComeAlive } from '../../state/session';
import { getState, useStore } from '../../state/store';
import { useReducedMotion } from '../../ui/a11y';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { playUiSound } from '../../ui/sounds';
import { StorageBanner } from '../files/StorageBanner';
import { BottomPath, NightSky } from '../trail/Landscape';
import { HomeHeader } from '../trail/HomeHeader';
import { AliveStage, type AliveGeometry, type AliveStageHandle } from './AliveStage';
import { keepDoodle } from './doodle';
import { FirstColumn } from './FirstColumn';
import { kindSentence, KindChip } from './KindChip';
import { NameChip } from './NameChip';
import { pickName } from './names';
import { PENS, PenDock, type PenSize } from './PenDock';
import './first.css';

/** Bring it to life wakes up once this share of the paper is inked (§2.3). */
export const INK_MIN = 0.015;
/** The pencil ground line, as a share of the paper's height. */
const GROUND_LINE = 0.88;
/** Board pixels per CSS pixel of paper (crisp on 1.25-2x Chromebook screens), capped at 1024. */
const BOARD_DENSITY = 1.5;
const BOARD_MAX = 1024;

type Phase = 'drawing' | 'rigging' | 'alive';

interface Alive {
  record: ArtRecord;
  rig: RigData;
  flat: Blob;
  geo: AliveGeometry;
}

function cssToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function facingNumber(f: Facing): 1 | -1 | 0 {
  return f === 'right' ? 1 : f === 'left' ? -1 : 0;
}

export function FirstPage() {
  const { store } = useServices();
  const reduced = useReducedMotion();
  const pressure = useStore((s) => s.prefs.pressure);
  const assignment = useStore((s) => s.config.classLink?.asg ?? null);

  const paperRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<ArtSurface | null>(null);
  const stageRef = useRef<AliveStageHandle>(null);
  const firstCard = useRef<HTMLButtonElement | null>(null);
  const lifeButton = useRef<HTMLButtonElement>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const [landed, setLanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [inked, setInked] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [color, setColor] = useState(PENS[0].color);
  const [size, setSize] = useState<PenSize>(10);
  const [erasing, setErasing] = useState(false);
  const [touched, setTouched] = useState(false);

  const [phase, setPhase] = useState<Phase>('drawing');
  const [alive, setAliveState] = useState<Alive | null>(null);
  // The latest creature, for changes that overlap (a rename while new bones are found).
  const aliveRef = useRef<Alive | null>(null);
  const setAlive = useCallback((next: Alive | null) => {
    aliveRef.current = next;
    setAliveState(next);
  }, []);
  const [awake, setAwake] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CharacterKind>('blob');
  const [facing, setFacing] = useState<Facing>('viewer');
  const [kindBusy, setKindBusy] = useState(false);
  // The kind and facing asked for last: the picker shows them at once, the bones follow.
  const kindWant = useRef<{ kind: CharacterKind; facing: Facing } | null>(null);
  const kindRunning = useRef(false);
  const [note, setNote] = useState<string | null>(null);
  const [pose, setPose] = useState<PoseImage | null>(null);
  const [busySeed, setBusySeed] = useState<StarterId | null>(null);

  // The night fades in, the lanterns light, then the paper slides up (§2.3 Motion).
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ------------------------------------------------------------ the drawing surface
  useLayoutEffect(() => {
    const host = boardRef.current;
    if (!host) return;
    const box = host.getBoundingClientRect();
    const k = Math.min(BOARD_DENSITY, BOARD_MAX / Math.max(1, box.width, box.height));
    const W = Math.max(64, Math.round(box.width * k));
    const H = Math.max(64, Math.round(box.height * k));
    const paper = cssToken('--paper', '#fdf8ec');
    const doc = newArtDoc({ name: '', kind: 'character', rig: 'blob', width: W, height: H, layers: 'dock' });
    const surface = createArtSurface(host, doc, { paper, workspace: paper, keyboard: false, rotate: false, pressure: getState().prefs.pressure, reducedMotion: document.documentElement.dataset.motion === 'reduced' });
    surfaceRef.current = surface;
    host.setAttribute('aria-label', t('home.paperLabel'));

    // The paper is a sheet, not a canvas to fly around: the board always fills it exactly.
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      const v = surface.view();
      const zoom = Math.min(v.cssW / W, v.cssH / H);
      const want = { zoom, rot: 0, panX: (v.cssW - W * zoom) / 2, panY: (v.cssH - H * zoom) / 2 };
      if (Math.abs(v.zoom - want.zoom) < 1e-4 && Math.abs(v.panX - want.panX) < 0.5 && Math.abs(v.panY - want.panY) < 0.5 && v.rot === 0) return;
      fitting = true;
      surface.setView(want);
      fitting = false;
    };
    const offs: Array<() => void> = [];
    let live = true;
    void surface.ready.then(() => {
      if (!live) return;
      surface.setTool('ink');
      surface.setColor(PENS[0].color);
      surface.setSize(10);
      fit();
      setReady(true);
    });
    offs.push(surface.on('inked', (e) => setInked(e.inked)));
    offs.push(surface.on('history', (h) => setCanUndo(h.canUndo)));
    offs.push(
      surface.on('view', () => {
        requestAnimationFrame(() => live && fit());
      }),
    );
    const ro = new ResizeObserver(() => live && requestAnimationFrame(() => live && fit()));
    ro.observe(host);
    const stopWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    let warmed = false;
    const firstTouch = () => {
      // A pen on the paper while it still slides in: it lands at once (before the stroke reads where the
      // paper is), so the line stays under the pen instead of bending with the paper.
      rootRef.current?.classList.add('first--landed');
      setLanded(true);
      setTouched(true);
      // Start the rig worker while the student draws, so Bring it to life never waits for it to load.
      if (!warmed) {
        warmed = true;
        void rigWorker.clear().catch(() => undefined);
      }
    };
    const cell = host.parentElement;
    cell?.addEventListener('wheel', stopWheel, { capture: true, passive: false });
    host.addEventListener('pointerdown', firstTouch, { capture: true });
    return () => {
      live = false;
      ro.disconnect();
      offs.forEach((off) => off());
      cell?.removeEventListener('wheel', stopWheel, { capture: true });
      host.removeEventListener('pointerdown', firstTouch, { capture: true });
      surface.destroy();
      surfaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // The student's pen feel follows Settings (§7.5).
    surfaceRef.current?.setPressure({ feel: pressure });
  }, [pressure, ready]);

  // ------------------------------------------------------------ the dock
  const pickColor = (c: string) => {
    const s = surfaceRef.current;
    setErasing(false);
    setColor(c);
    if (s && ready) {
      s.setTool('ink');
      s.setColor(c);
      s.setSize(size);
    }
    const pen = PENS.find((p) => p.color === c);
    if (pen) announce(t('home.penPicked', { pen: t(pen.label) }));
  };

  const pickSize = (next: PenSize) => {
    setSize(next);
    surfaceRef.current?.setSize(erasing ? next * 2 : next);
    announce(t('home.penSize', { size: t(next === 5 ? 'home.sizeSmall' : next === 10 ? 'home.sizeMedium' : 'home.sizeBig') }));
  };

  const toggleEraser = () => {
    const s = surfaceRef.current;
    if (!s || !ready) return;
    if (erasing) {
      pickColor(color);
      return;
    }
    setErasing(true);
    s.setTool('eraser');
    s.setSize(size * 2);
    announce(t('home.penPicked', { pen: t('home.eraser') }));
  };

  const undo = () => {
    void surfaceRef.current?.undo();
  };

  const moreTools = async () => {
    if (alive) {
      navigate({ name: 'drawFree', artId: alive.record.id });
      return;
    }
    const s = surfaceRef.current;
    if (!s || s.inked() === 0) {
      navigate({ name: 'drawFree', artId: 'new' });
      return;
    }
    await s.flush();
    const id = await keepDoodle(await s.doc(), pickName(getState().library.characters.map((c) => c.name)));
    navigate({ name: 'drawFree', artId: id });
  };

  // ------------------------------------------------------------ Bring it to life
  const canBring = phase === 'drawing' && ready && inked >= INK_MIN;
  /**
   * Why the button still waits: nothing drawn yet, or a drawing too small or thin to wake (a thin stick
   * figure). The ink share is counted a moment after each stroke, so a stroke to undo counts as drawn too.
   */
  const notEnoughInk = (drawn: boolean) => showToast(t(drawn ? 'home.moreInk' : 'home.noInkYet'));

  const bring = async () => {
    const s = surfaceRef.current;
    const host = boardRef.current;
    if (!s || !host || phase !== 'drawing') return;
    if (s.inked() < INK_MIN) {
      notEnoughInk(s.inked() > 0);
      return;
    }
    setPhase('rigging');
    try {
      await s.flush();
      const anchorBoard = s.anchor();
      const doc = await s.doc();
      const chosen = pickName(getState().library.characters.map((c) => c.name));
      const result = await bringToLife({ doc: { ...doc, name: chosen }, artId: null, name: chosen, kind: 'character', rig: 'blob', mode: 'free', parts: {}, worldId: null, castKey: null, shelf: true, guideHints: null });
      const exp = result.record.export;
      const rig = result.record.rigData;
      const flat = exp ? await store.blobs.get(exp.flat) : null;
      if (!exp || !flat || !rig || !anchorBoard) throw new Error('The drawing came back without bones.');
      // Where the drawing stands on screen: the export's anchor is its feet (§7.7).
      const box = host.getBoundingClientRect();
      const feet = s.docToClient(anchorBoard[0], anchorBoard[1]);
      const top = s.docToClient(anchorBoard[0], anchorBoard[1] - exp.anchor[1]);
      const zoom = s.view().zoom;
      const geo: AliveGeometry = {
        boxW: box.width,
        boxH: box.height,
        feetX: feet.x - box.left,
        feetY: feet.y - box.top,
        height: Math.max(8, feet.y - top.y),
        left: exp.anchor[0] * zoom,
        right: (exp.w - exp.anchor[0]) * zoom,
        line: GROUND_LINE,
      };
      setName(chosen);
      setAlive({ record: result.record, rig, flat, geo });
      setPhase('alive');
      markSeen('firstPage');
      void refreshLibrary(store);
    } catch (err) {
      console.warn('Bring it to life failed:', err);
      setPhase('drawing');
      showToast(t('home.lifeFailed'), { kind: 'error' });
    }
  };

  const onShown = useCallback(() => {
    setHidden(true);
    playUiSound('alive');
  }, []);

  const onAwake = useCallback(() => {
    setAwake(true);
    announce(t('home.cameAlive', { name }));
  }, [name]);

  // The world cards pose the creature once it is awake (not while the wake still needs the worker).
  useEffect(() => {
    const exp = alive?.record.export;
    if (!awake || !alive || !exp) return;
    let live = true;
    const r = alive.record;
    void renderPose(`${r.id}:${r.version}:${alive.rig.kind}:${r.facing}`, alive.flat, alive.rig, exp.anchor)
      .then((p) => live && setPose(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [awake, alive]);

  // Focus follows the magic: Bring it to life is gone, so the first world card takes focus.
  useEffect(() => {
    if (!awake) return;
    const id = window.setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body || document.activeElement === lifeButton.current) firstCard.current?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(id);
  }, [awake]);

  // ------------------------------------------------------------ the chips
  const rename = async (next: string) => {
    const cur = aliveRef.current;
    if (!cur) return;
    const record: ArtRecord = { ...cur.record, name: next, updatedAt: Date.now() };
    setName(next);
    setAlive({ ...cur, record });
    await store.commit({ art: [record] }).catch(() => showToast(t('home.couldNotSave'), { kind: 'error' }));
    void refreshLibrary(store);
  };

  /** New bones for one choice of kind and facing; a kind with no limbs to find keeps the old bones. */
  const applyKind = async (want: { kind: CharacterKind; facing: Facing }) => {
    const cur = aliveRef.current;
    if (!cur) return;
    const rec = cur.record;
    let rig = cur.rig;
    let confidence = rec.rigInfo?.confidence ?? 1;
    let notes = rec.rigInfo?.notes ?? [];
    let kindNow = (rec.rig === 'none' ? 'blob' : rec.rig) as CharacterKind;
    if (want.kind !== kindNow) {
      const mask = rec.export?.inkMask ? await store.blobs.get(rec.export.inkMask) : null;
      const reply = await rigWorker.autoRig({ image: cur.flat, ...(mask ? { layers: { lines: mask } } : {}) }, { kind: want.kind, lane: `rig:${rec.id}` });
      if (reply.confidence < 0.5 && want.kind !== 'blob') {
        setNote(t('home.kindNoLimbs', { name: rec.name }));
      } else {
        rig = reply.rig;
        confidence = reply.confidence;
        notes = reply.notes;
        kindNow = want.kind;
      }
    }
    rig = setRigFacing(rig, facingNumber(want.facing));
    await stageRef.current?.rerig(rig);
    // Built on the latest record, so a rename made meanwhile stays.
    const latest = aliveRef.current ?? cur;
    const record: ArtRecord = { ...latest.record, rig: kindNow, facing: want.facing, rigData: rig, rigInfo: { made: 'auto', confidence, notes }, updatedAt: Date.now() };
    setAlive({ ...latest, record, rig });
    if (!kindWant.current) {
      // The picker shows what the creature really is now (a kind without limbs goes back).
      setKind(kindNow);
      setFacing(want.facing);
    }
    if (kindNow === want.kind) announce(t('home.kindChanged', { name: record.name, kind: kindSentence(kindNow) }));
    await store.commit({ art: [record] });
    void refreshLibrary(store);
  };

  const changeKind = async (nextKind: CharacterKind, nextFacing: Facing) => {
    if (!aliveRef.current) return;
    setKind(nextKind);
    setFacing(nextFacing);
    kindWant.current = { kind: nextKind, facing: nextFacing };
    if (kindRunning.current) return;
    kindRunning.current = true;
    setKindBusy(true);
    setNote(null);
    try {
      while (kindWant.current) {
        const want = kindWant.current;
        kindWant.current = null;
        await applyKind(want);
      }
    } catch (err) {
      console.warn('The new bones did not work:', err);
      kindWant.current = null;
      const rec = aliveRef.current?.record;
      if (rec) {
        setKind((rec.rig === 'none' ? 'blob' : rec.rig) as CharacterKind);
        setFacing(rec.facing);
        setNote(t('home.kindNoLimbs', { name: rec.name }));
      }
    } finally {
      kindRunning.current = false;
      setKindBusy(false);
    }
  };

  // ------------------------------------------------------------ worlds
  const pickSeed = async (seed: StarterId) => {
    if (!alive || busySeed) return;
    setBusySeed(seed);
    try {
      // The "From your teacher" card starts the assignment itself (Hand in, its goals), with this hero.
      const world = assignment?.starter === seed ? (await createAssignmentWorld(assignment, alive.record.id)).world : await openSeed(seed, alive.record.id);
      // The creature flies from the paper into its place in the running world (M2 plays the flight).
      const exp = alive.record.export;
      const from = stageRef.current?.box() ?? null;
      if (exp && from) {
        const key = Object.values(world.cast).find((slot) => slot.art === alive.record.id)?.key ?? null;
        const sticker = await store.blobs.url(exp.sticker).catch(() => null);
        if (sticker) {
          // The session holds the new world first, so the world screen keeps the flight when it opens it.
          await openWorld(world.id);
          setComeAlive({ key, artId: alive.record.id, sticker, from });
        }
      }
      // The paper morphs into the world view (§2.3): M2 names its world view the same.
      transitionName(paperRef.current, 'world-view');
      navigate({ name: 'world', id: world.id });
    } catch (err) {
      console.warn('The world could not open:', err);
      showToast(t('home.couldNotSave'), { kind: 'error' });
      setBusySeed(null);
    }
  };

  const pickStarter = (id: StarterId) => navigate({ name: 'starter', id });

  // ------------------------------------------------------------ render
  const paperStyle = { ['--ground-line' as string]: `${GROUND_LINE * 100}%` } as CSSProperties;

  return (
    <div ref={rootRef} className={cx('first', entered && 'first--entered', reduced && 'first--still', landed && 'first--landed')} data-testid="screen-first" data-phase={phase} data-awake={awake || undefined}>
      <NightSky decor={false} />
      <BottomPath lit={entered} />
      <HomeHeader />
      <main id="main" tabIndex={-1} className="first__main">
        <div className="first__banner">
          <StorageBanner />
        </div>
        <PenDock
          color={color}
          size={size}
          erasing={erasing}
          canUndo={canUndo}
          resting={phase !== 'drawing'}
          onColor={pickColor}
          onSize={pickSize}
          onEraser={toggleEraser}
          onUndo={undo}
          onMoreTools={() => void moreTools()}
        />
        <div className="first__paper-cell" style={paperStyle}>
          <div ref={paperRef} className="first__sheet" aria-hidden="true">
            <span className="first__tape first__tape--lemon" />
            <span className="first__tape first__tape--lime" />
          </div>
          <div className="first__inner">
            <div className={cx('first__board', hidden && 'first__board--gone')} ref={boardRef} data-testid="first-board" />
            <svg className="first__ground" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden="true">
              <path d="M3 5.2 C20 4.6 32 5.5 50 5 S80 4.4 97 5.1" />
            </svg>
            {alive && <AliveStage ref={stageRef} flat={alive.flat} rig={alive.rig} geo={alive.geo} name={name} reduced={reduced} onShown={onShown} onAwake={onAwake} />}
            {awake && alive && (
              <p
                className="first__alive-note"
                style={
                  {
                    left: Math.max(8, Math.min(alive.geo.boxW - 200, alive.geo.feetX + alive.geo.right * 0.45)),
                    top: Math.max(96, alive.geo.feetY - alive.geo.height - 24),
                  } as CSSProperties
                }
              >
                <span>{t('home.itsAlive')}</span>
              </p>
            )}
          </div>
          <div className="first__texture" aria-hidden="true" />
          <div className="first__front on-paper">
            <div className="first__heading">
              <h1 className="first__title">{t('home.firstTitle')}</h1>
              <p className="first__sub">{t('home.firstSub')}</p>
              <p className={cx('first__hint', (touched || phase !== 'drawing') && 'first__hint--gone')} aria-hidden="true">
                <span>{t('home.firstHint')}</span>
                <svg width="70" height="64" viewBox="0 0 70 64" aria-hidden="true">
                  <path className="first__hint-arrow" d="M8 6c18 6 34 18 42 38" />
                  <path className="first__hint-arrow" d="M40 40l10 6 3-12" />
                </svg>
              </p>
            </div>
            {phase !== 'alive' ? (
              <div className="first__life">
                <p className="first__life-hint">{t('home.firstLifeHint')}</p>
                <Button
                  ref={lifeButton}
                  variant="paper"
                  size={44}
                  icon="sparkle"
                  className={cx('first__life-button', canBring && 'first__life-button--ready')}
                  aria-disabled={!canBring || undefined}
                  busy={phase === 'rigging'}
                  onClick={() => (canBring ? void bring() : phase === 'drawing' && notEnoughInk(inked > 0 || canUndo))}
                  data-testid="bring-to-life"
                >
                  {phase === 'rigging' ? t('home.findingBones') : t('home.bringItToLife')}
                </Button>
              </div>
            ) : (
              <div className={cx('first__chips', awake && 'first__chips--on')}>
                {awake && (
                  <>
                    <KindChip kind={kind} facing={facing} busy={kindBusy} onChange={(k, f) => void changeKind(k, f)} />
                    <NameChip name={name} onRename={(n) => void rename(n)} />
                    <span className="first__tap-hint">
                      {kindBusy ? t('home.kindChanging') : (note ?? t('home.tapHint', { name }))}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="first__trust">
          <Icon name="lock" size={18} />
          <span>{t('home.trustFirst')}</span>
        </p>
        <aside className="first__col" aria-label={awake ? t('home.giveWorldTitle', { name }) : t('home.playFirstTitle')}>
          <FirstColumn
            alive={awake && alive ? { id: alive.record.id, name, pose, hero: { id: alive.record.id, name, kind: 'character', rig: kind } } : null}
            assignment={assignment}
            busySeed={busySeed}
            onSeed={(s) => void pickSeed(s)}
            onStarter={pickStarter}
            firstCard={(el) => {
              firstCard.current = el;
            }}
          />
        </aside>
      </main>
    </div>
  );
}
