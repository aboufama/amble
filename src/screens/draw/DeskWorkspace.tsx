/**
 * The Desk's workspace (§2.10): the top bar, the tool rail, the guide strip, the sheet with the request
 * note and the pivot pin, the view bar, and the side panel with the preview card. Owns the controller (one
 * per drawing), the keys, saving, and Bring to life.
 *
 * Keys (§7.2), while the sheet has focus and single keys are on: B P M C A E G L U tools, I (or hold Alt)
 * pick a colour, `[` `]` size, 1-9 and 0 opacity, X the last colour, F fit, `,` `.` pages. Always:
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+S save, Ctrl+J copy layer, Ctrl+E join down, Ctrl+Shift+N new
 * layer, Ctrl+0 fit, Ctrl+1 100 %.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useCommand } from '../../app/keys';
import { navigate } from '../../app/router';
import type { Route } from '../../app/routes';
import { useServices } from '../../app/services';
import { bringToLife, pairsOf } from '../../draw/api';
import { DeskController } from '../../draw/deskController';
import type { DeskSetup } from '../../draw/load';
import { hasBones } from '../../draw/request';
import { t } from '../../i18n';
import type { CharacterKind, Facing } from '../../model/types';
import { announce, showToast } from '../../state/app';
import { setComeAlive } from '../../state/session';
import { setDraw } from '../../state/draw';
import { useStore } from '../../state/store';
import { isTextField, useReducedMotion } from '../../ui/a11y';
import { Button, IconButton, Menu, Tag } from '../../ui/components';
import { cx } from '../../ui/cx';
import { askUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';
import { PAPER, THEMES } from '../../ui/tokens';
import { TopBar } from '../../app/frame/TopBar';
import { BuildPill } from '../ai/BuildPill';
import { KindPicker } from '../bones/KindPicker';
import { colorName } from './ColorPanel';
import { DeskToast, PivotPin } from './DeskBits';
import { GuideStrip } from './GuideStrip';
import { PhotoImport } from './PhotoImport';
import { RequestNote } from './RequestNote';
import { SidePanel } from './SidePanel';
import { TimeLapse } from './TimeLapse';
import { hasOptions, ToolOptions } from './ToolOptions';
import { ToolRail } from './ToolRail';
import { useDeskEvent, useDeskState } from './useDesk';
import { ViewBar } from './ViewBar';
import { saveOnClose, useDeskSaving } from './useDeskSaving';

/** Above this (estimated bytes of pixels and undo), the Desk suggests merging (§2.10). */
const MEMORY_WARN = 250 * 1024 * 1024;

export function DeskWorkspace({ setup }: { setup: DeskSetup }) {
  const services = useServices();
  const { store, player, files } = services;
  const prefs = useStore((st) => st.prefs);
  const layout = useStore((st) => st.app.layout);
  const reduced = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [ctrl, setCtrl] = useState<DeskController | null>(null);
  const s = useDeskState(ctrl);
  const [name, setName] = useState(setup.record?.name ?? setup.request.name);
  const nameRef = useRef(name);
  nameRef.current = name;
  const nameOf = useCallback(() => nameRef.current, []);
  const saving = useDeskSaving(ctrl, setup, store, files, nameOf);
  const [toast, setToast] = useState<string | null>(null);
  const [bringing, setBringing] = useState(false);
  const [watching, setWatching] = useState(false);
  const [photo, setPhoto] = useState<'lines' | 'trace' | null>(null);
  const brought = useRef(false);
  const memoryWarned = useRef(false);
  const request = setup.request;
  const free = request.key === null;
  const touch = layout === 'touch';

  // One controller per drawing; the drawing is saved as the Desk closes.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = new DeskController({
      host,
      doc: setup.doc,
      request: setup.request,
      board: setup.board,
      mode: setup.mode,
      parts: setup.parts,
      steps: setup.steps.map((st) => ({ step: st.step, parts: [...st.parts] })),
      prefs: { pressure: prefs.pressure, reducedMotion: reduced },
      heroImage: setup.heroImage,
      partBones: setup.partBones,
      colors: { paper: PAPER.paper, workspace: THEMES[prefs.theme].bg },
    });
    setCtrl(c);
    setStage(stageRef.current);
    return () => {
      setCtrl(null);
      if (!brought.current) saveOnClose(c, savingRef.current, setup, store, nameRef.current);
      c.destroy();
    };
    // The controller lives as long as this drawing is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);
  const savingRef = useRef(saving);
  savingRef.current = saving;

  useEffect(() => setDraw({ tool: s?.tool ?? 'ink', mode: s?.mode ?? setup.mode }), [s?.tool, s?.mode, setup.mode]);

  // The Desk's test hook (§10.2), in dev builds only: the open drawing's controller.
  useEffect(() => {
    if (!import.meta.env.DEV || !ctrl) return;
    const w = window as unknown as { __ambleDesk?: DeskController | null };
    w.__ambleDesk = ctrl;
    return () => {
      if (w.__ambleDesk === ctrl) w.__ambleDesk = null;
    };
  }, [ctrl]);

  // The paper's words: a toast above the view bar; tool and colour changes are announced.
  useDeskEvent(ctrl, (e) => {
    if (e.type === 'toast') setToast(e.text);
    else if (e.type === 'announce') announce(e.text);
    else if (e.type === 'penup' && ctrl && !memoryWarned.current) {
      const st = ctrl.surface.stats();
      if (st.pixels + st.history.bytes > MEMORY_WARN) {
        memoryWarned.current = true;
        showToast(t('draw.memory'));
      }
    }
  });
  const color = s?.color;
  const firstColor = useRef(true);
  useEffect(() => {
    if (!color) return;
    if (firstColor.current) {
      firstColor.current = false;
      return;
    }
    announce(colorName(color));
  }, [color]);
  const clearToast = useCallback(() => setToast(null), []);

  // A lost canvas (a GPU reset) comes back from the layers in memory.
  useEffect(() => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas || !ctrl) return;
    const lost = (e: Event) => {
      e.preventDefault();
      setToast(t('draw.gpuReset'));
    };
    const back = () => ctrl.renderGuidesNow();
    canvas.addEventListener('contextlost', lost);
    canvas.addEventListener('contextrestored', back);
    return () => {
      canvas.removeEventListener('contextlost', lost);
      canvas.removeEventListener('contextrestored', back);
    };
  }, [ctrl, s?.ready]);

  // ------------------------------------------------------------------------------------------ keys

  useCommand('undo', () => {
    if (!ctrl) return false;
    void ctrl.undo();
  });
  useCommand('redo', () => {
    if (!ctrl) return false;
    void ctrl.redo();
  });
  useCommand('save', () => {
    void saving.saveNow();
  });
  // F is "fit" on the sheet (the world's full-screen key does not apply here).
  useCommand('fullscreen', () => {
    if (!ctrl || !hostRef.current?.contains(document.activeElement)) return false;
    ctrl.fit();
  });

  const onSheetKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ctrl || isTextField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const active = ctrl.getSnapshot().active;
      const handled =
        (k === 'j' && (ctrl.duplicateLayer(active), true)) ||
        (k === 'e' && (void ctrl.mergeDown(active), true)) ||
        (k === 'n' && e.shiftKey && (ctrl.addLayer('plain'), true)) ||
        (k === '0' && (ctrl.fit(), true)) ||
        (k === '1' && (ctrl.surface.zoomTo(1), true)) ||
        ((k === '=' || k === '+') && (ctrl.zoomBy(1.25), true)) ||
        (k === '-' && (ctrl.zoomBy(1 / 1.25), true));
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'Alt') {
      e.preventDefault();
      ctrl.setPicking(true);
      return;
    }
    if (!prefs.singleKeys || e.repeat) return;
    if (ctrl.onKey(e.nativeEvent)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onSheetKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Alt' || e.key === 'i' || e.key === 'I') ctrl?.setPicking(false);
  };

  // ------------------------------------------------------------------------------------------ Bring to life

  const bring = async () => {
    if (!ctrl || bringing) return;
    const st = ctrl.getSnapshot();
    if (!st.ready) return;
    if (!ctrl.hasInk()) {
      setToast(t('draw.drawFirst'));
      return;
    }
    setBringing(true);
    announce(t('draw.bringing'));
    try {
      ctrl.stopFlipbook();
      if (st.selection?.floating) ctrl.commitSelection();
      const r = ctrl.request;
      const drawnPairs = st.mode === 'bones' ? pairsOf(Object.fromEntries(st.drawn.map((p) => [p, st.parts[p]]))) : [];
      const exported = await ctrl.surface.export({ maxSize: setup.board.exportMax, thumbSize: 128, ...(drawnPairs.length ? { pairs: drawnPairs } : {}) });
      if (!exported) {
        setToast(t('draw.drawFirst'));
        return;
      }
      const doc = await ctrl.surface.doc();
      const hints = ctrl.rigHints();
      const res = await bringToLife({
        doc,
        artId: setup.artId,
        name,
        kind: r.kind,
        rig: r.rig,
        mode: st.mode,
        parts: st.parts,
        worldId: setup.world?.id ?? null,
        castKey: r.key,
        shelf: free,
        guideHints: hints.guideHints,
        exported,
        exportMax: setup.board.exportMax,
        facing: r.facing,
        role: r.role,
        partHints: hints.partHints,
      });
      brought.current = true;
      saving.broughtToLife(res.record);
      ctrl.surface.markSaved();
      const from = hostRef.current?.getBoundingClientRect() ?? new DOMRect();
      setComeAlive({ key: r.key, artId: res.record.id, sticker: res.sticker, from });
      announce(t('draw.cameAlive', { name }));
      if (res.onePiece) showToast(t('draw.noLimbs', { name }));
      const bonesRoute: Route = setup.world && r.key ? { name: 'bones', worldId: setup.world.id, key: r.key } : { name: 'bonesFree', artId: res.record.id };
      if (res.lowConfidence) showToast(t('draw.lowConfidence'), { action: { label: t('draw.check'), run: () => navigate(bonesRoute) } });
      if (setup.world && r.key) navigate({ name: 'world', id: setup.world.id });
      else {
        navigate({ name: 'trail', view: 'trail' });
        showToast(t('draw.giveWorld', { name }));
      }
    } catch (err) {
      console.error('Bring to life failed:', err);
      showToast(t('draw.bringFailed'), { kind: 'error' });
    } finally {
      setBringing(false);
    }
  };

  const toBones = async () => {
    if (!ctrl) return;
    await saving.saveNow();
    navigate(setup.world && request.key ? { name: 'bones', worldId: setup.world.id, key: request.key } : { name: 'bonesFree', artId: setup.artId });
  };

  const rename = async () => {
    const next = await askUser({ title: t('draw.namePrompt'), label: t('draw.namePrompt'), value: name, maxLength: 40 });
    if (next?.trim()) {
      setName(next.trim());
      if (ctrl) ctrl.request = { ...ctrl.request, name: next.trim() };
    }
  };

  // ------------------------------------------------------------------------------------------ layout

  const back: { to: Route; label: string } = setup.world ? { to: { name: 'world', id: setup.world.id }, label: setup.world.title } : { to: { name: 'trail', view: 'trail' }, label: t('common.backToTrail') };
  const character = hasBones({ kind: request.kind, rig: s?.kind ?? request.rig });
  const bonesKind = character && (s?.kind ?? request.rig) !== 'object';
  const showStrip = request.kind === 'character' && request.rig !== 'none';
  const inked = (s?.inked ?? 0) > 0;
  const moreItems = useMemo(
    () => [
      { id: 'watch', label: t('draw.watchItDrawn'), icon: 'play' as const, onSelect: () => setWatching(true) },
      { id: 'photo', label: t('draw.usePhoto'), icon: 'trace' as const, onSelect: () => setPhoto('lines') },
      { id: 'trace', label: t('draw.tracePhoto'), icon: 'trace' as const, onSelect: () => setPhoto('trace') },
    ],
    [],
  );

  const title = (
    <>
      {free ? (
        <button type="button" className="desk__title desk__title--edit" onClick={() => void rename()} aria-label={`${t('draw.drawingTitle', { name })}. ${t('draw.nameIt')}`}>
          <h1 className="topbar__title">{t('draw.drawingTitle', { name })}</h1>
          <Icon name="draw" size={18} />
        </button>
      ) : (
        <h1 className="topbar__title desk__title">{t('draw.drawingTitle', { name })}</h1>
      )}
      {request.role && <Tag role={request.role} variant="paper" className="desk__role" />}
      {setup.world && <BuildPill worldId={setup.world.id} />}
    </>
  );

  const actions = (
    <>
      <span className={cx('desk__saved', saving.status === 'failed' && 'desk__saved--failed')} role="status">
        {saving.status === 'saving' ? t('draw.saving') : saving.status === 'saved' ? (
          <>
            <Icon name="check" size={16} />
            {t('draw.saved')}
          </>
        ) : null}
      </span>
      <Button variant="ghost" icon="undo" onClick={() => void ctrl?.undo()} disabled={!s?.canUndo} aria-keyshortcuts="Control+Z">
        {t('draw.undo')}
      </Button>
      <IconButton icon="redo" label={t('draw.redo')} variant="ghost" onClick={() => void ctrl?.redo()} disabled={!s?.canRedo} aria-keyshortcuts="Control+Shift+Z" />
      <Menu label={t('draw.more')} icon="more" variant="ghost" items={moreItems} />
      {bonesKind && inked && (
        <Button variant="ghost" icon="bones" onClick={() => void toBones()}>
          {t('draw.bones')}
        </Button>
      )}
      <Button variant="lantern" icon="sparkle" onClick={() => void bring()} busy={bringing} disabled={!s?.ready || bringing} className="desk__bring" data-testid="bring-to-life">
        {bringing ? t('draw.bringing') : t('draw.bringToLife')}
      </Button>
    </>
  );

  const options = ctrl && s && hasOptions(s.tool) ? <ToolOptions ctrl={ctrl} s={s} /> : null;

  return (
    <div className={cx('screen desk', prefs.leftHanded && 'desk--left', touch && 'desk--touch', !showStrip && 'desk--nostrip')} data-testid="screen-draw">
      <TopBar className="desk__top" back={back} center={title} actions={actions} aiChip={false} />
      <nav className="desk__rail" aria-label={t('draw.toolsLabel')}>
        <ToolRail tool={s?.tool ?? (setup.board.pixelArt ? 'pixel' : 'ink')} pixelArt={setup.board.pixelArt} onTool={(tool) => ctrl?.setTool(tool)} onTrace={() => setPhoto('trace')} options={touch ? options : undefined} disabled={!s?.ready} />
      </nav>
      <main id="main" tabIndex={-1} className="desk__area">
        {showStrip && ctrl && s && (
          <div className="desk__strip">
            <GuideStrip ctrl={ctrl} s={s} bones={bonesKind || s.mode === 'bones'} />
            {free && s.mode === 'free' && (
              <div className="desk__kind">
                <KindPicker value={(s.kind === 'none' ? 'biped' : s.kind) as CharacterKind} facing={s.facing as Facing} compact onChange={(k, f) => ctrl.setKind(k, f)} />
              </div>
            )}
          </div>
        )}
        <div ref={stageRef} className="desk__stage">
          <div
            ref={hostRef}
            className={cx('desk__sheet', s?.picking && 'desk__sheet--picking')}
            data-testid="desk-board"
            aria-describedby="desk-sheet-help"
            onKeyDown={onSheetKey}
            onKeyUp={onSheetKeyUp}
          />
          <p id="desk-sheet-help" className="sr-only">
            {t('draw.sheetHelp')}
          </p>
          <RequestNote request={ctrl?.request ?? request} readAloudOn={prefs.readAloud} onToast={setToast} />
          {ctrl && s?.guides && <PivotPin ctrl={ctrl} pin={s.pin} name={name} stage={stage} />}
          <DeskToast text={toast} onDone={clearToast} />
          {!s?.ready && (
            <div className="desk__opening" aria-hidden="true">
              <span className="desk__spinner" />
            </div>
          )}
        </div>
        {ctrl && s && <ViewBarSlot ctrl={ctrl} />}
      </main>
      <aside className="desk__side" aria-label={t('draw.openPanel')}>
        {ctrl && s && <SidePanel ctrl={ctrl} s={s} setup={setup} player={player} store={store} options={!touch} brought={() => brought.current} />}
      </aside>
      {ctrl && <TimeLapse open={watching} onClose={() => setWatching(false)} ctrl={ctrl} name={name} />}
      {ctrl && photo && <PhotoImport open={photo !== null} onClose={() => setPhoto(null)} ctrl={ctrl} mode={photo} onDone={setToast} />}
      <p className="sr-only" aria-live="polite">
        {s?.ready ? '' : t('draw.loading')}
      </p>
    </div>
  );
}

/** The view bar reads the controller's state itself (zoom changes often; the rest of the Desk does not care). */
function ViewBarSlot({ ctrl }: { ctrl: DeskController }) {
  const s = useDeskState(ctrl);
  if (!s) return null;
  return (
    <div className="desk__viewbar">
      <ViewBar ctrl={ctrl} s={s} />
    </div>
  );
}

