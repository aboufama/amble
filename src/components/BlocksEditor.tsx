import { useEffect, useRef } from 'react';
import { AMBLE_THEME, Blockly, MAKE_SKILL, MAKE_VARIABLE, registerBlockly, toolboxFor, type PaletteContext } from '../blocks/blockly';
import { FieldAmbleMenu, FieldCharacter, setMenuHost } from '../blocks/fields';
import { BLOCK_SCALE, addZoomControls } from '../blocks/workspaceUi';
import { globalVariables, procedureNames, variablesFor, type MenuContext } from '../blocks/menus';
import type { MenuKind } from '../blocks/spec';
import { findCompiledSprite, findTarget, useStore } from '../store';
import { deleteVariable, keepCompiledSprite, registerLiveBlocks, renameVariable } from '../actions';
import { alertUser, askUser, confirmUser } from '../prompt';
import type { BlocksState } from '../project/types';
import { CodeIcon, KeepIcon } from './icons';

// Blockly's own questions ("Delete all 7 blocks?", text prompts on touch screens) use Amble's
// dialog, never the browser's.
Blockly.dialog.setConfirm((message, callback) => {
  const deleting = /^delete/i.test(message);
  void confirmUser({ title: deleting ? 'Delete Blocks' : 'Confirm', message, confirmLabel: deleting ? 'Delete' : 'OK', danger: deleting }).then(callback);
});
Blockly.dialog.setAlert((message, callback) => void alertUser({ title: 'Amble', message }).then(() => callback?.()));
Blockly.dialog.setPrompt((message, defaultValue, callback) => {
  void askUser({ title: 'Edit', label: message, defaultValue }).then((answer) => callback(answer ? answer.value : null));
});

/** What a field names, if anything: a dropdown's kind, or the character / variable on a round block. */
function fieldKind(block: Blockly.Block, field: Blockly.Field): MenuKind | null {
  if (field instanceof FieldAmbleMenu) return field.menuKind;
  if (field instanceof FieldCharacter) return 'character';
  if (block.type === 'mem_var' && field.name === 'VARIABLE') return 'variable';
  return null;
}

/** The Blockly workspace for the selected sprite (or the stage). */
export function BlocksEditor({ visible }: { visible: boolean }) {
  const divRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const loadedId = useRef<string | null>(null);
  const loading = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const paletteTimer = useRef<number | null>(null);
  const paletteKey = useRef('');
  const liveCache = useRef<BlocksState | null>(null);
  const newMessages = useRef<string[]>([]);
  const needsScroll = useRef(false);
  const visibleRef = useRef(visible);

  /** Untangles overlapping scripts and scrolls to their top-left corner (like Scratch), once Blockly has measured them. */
  const showScripts = (ws: Blockly.WorkspaceSvg) => {
    void Blockly.renderManagement.finishQueuedRenders().then(() => {
      if (wsRef.current !== ws || !visibleRef.current) return;
      needsScroll.current = false;
      const tops = ws.getTopBlocks(false);
      if (!tops.length) return;
      const boxes = tops.map((b) => b.getBoundingRectangle());
      const overlap = boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
      if (overlap) {
        loading.current = true;
        ws.cleanUp();
        loading.current = false;
        flushSave();
      }
      const box = ws.getBlocksBoundingBox();
      ws.scroll(24 - box.left * ws.scale, 24 - box.top * ws.scale);
    });
  };
  const selectedId = useStore((s) => s.selectedId);
  const projectLoads = useStore((s) => s.projectLoads);
  /** The project load the workspace shows: after a load, its blocks must not be saved into the new project. */
  const shownLoad = useRef(projectLoads);
  const target = useStore((s) => findTarget(s.project, s.selectedId));
  const compiledSprites = useStore((s) => s.project.compiled?.sprites);
  const project = useStore.getState().project;
  const compiledSprite = target || !compiledSprites ? null : findCompiledSprite(project, selectedId);
  // Like Scratch, a faded picture of the edited sprite sits in the code area's top right corner.
  const shown = target ? target.costumes[target.currentCostume] : null;
  const watermark = shown?.kind === 'image' ? shown.dataUrl : shown?.kind === 'model' ? shown.thumbnail : undefined;

  const flushSave = () => {
    const ws = wsRef.current;
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const id = loadedId.current;
    if (!ws || !id || shownLoad.current !== useStore.getState().projectLoads) return;
    const state = Blockly.serialization.workspaces.save(ws) as Record<string, unknown>;
    useStore.getState().update((p) => {
      const t = findTarget(p, id);
      if (t) t.blocks = state;
    });
  };

  /** What dropdowns and the palette need: the project, the edited sprite and its blocks as shown. */
  const menuContext = (): MenuContext => {
    const s = useStore.getState();
    const edited = findTarget(s.project, loadedId.current ?? s.selectedId);
    const ws = wsRef.current;
    return {
      project: s.project,
      target: edited,
      newMessages: newMessages.current,
      get liveBlocks() {
        if (!ws || loading.current || !loadedId.current) return undefined;
        liveCache.current ??= Blockly.serialization.workspaces.save(ws) as BlocksState;
        return liveCache.current;
      },
    };
  };

  const paletteContext = (): PaletteContext => {
    const s = useStore.getState();
    return { mode: s.project.mode, isStage: findTarget(s.project, s.selectedId)?.kind === 'stage', menus: menuContext() };
  };

  /** Rebuilds the palette when something it shows changed (costumes, sounds, variables, skills, characters...). */
  const refreshPalette = () => {
    const ws = wsRef.current;
    if (!ws) return;
    const def = toolboxFor(paletteContext());
    const key = JSON.stringify(def) + pictureKey();
    if (key === paletteKey.current) return;
    paletteKey.current = key;
    ws.updateToolbox(def);
  };

  /** What the character blocks' pictures show: each sprite's current costume. */
  const pictureKey = () => {
    const p = useStore.getState().project;
    return p.sprites.map((s) => `${s.name}:${s.costumes[s.currentCostume]?.id ?? ''}`).join('|');
  };
  const shownPictures = useRef('');
  /** Character blocks in the code area show the sprites' current pictures. */
  const refreshPictures = () => {
    const ws = wsRef.current;
    const key = pictureKey();
    if (!ws || key === shownPictures.current) return;
    shownPictures.current = key;
    for (const block of ws.getBlocksByType('char_ref', false)) {
      const field = block.getField('NAME');
      if (field instanceof FieldCharacter) field.forceRerender();
    }
  };
  const schedulePalette = () => {
    if (paletteTimer.current !== null) window.clearTimeout(paletteTimer.current);
    paletteTimer.current = window.setTimeout(() => {
      paletteTimer.current = null;
      refreshPalette();
    }, 120);
  };

  const renameMenus = (kinds: MenuKind[], from: string, to: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    Blockly.Events.disable();
    try {
      for (const block of ws.getAllBlocks(false)) {
        for (const input of block.inputList) {
          for (const field of input.fieldRow) {
            if (field.getValue() !== from) continue;
            const kind = fieldKind(block, field);
            if (kind && kinds.includes(kind)) field.setValue(to);
          }
        }
      }
    } finally {
      Blockly.Events.enable();
    }
    liveCache.current = null;
  };

  const makeVariable = async () => {
    const s = useStore.getState();
    const edited = findTarget(s.project, loadedId.current ?? s.selectedId);
    const answer = await askUser({ title: 'New Variable', label: 'New variable name:', scope: edited?.kind === 'sprite' });
    const name = answer?.value.trim();
    if (!answer || !name) return;
    const { project: p, notify, update } = useStore.getState();
    const taken = new Set([...variablesFor(p, edited), ...(answer.scope === 'global' ? p.sprites.flatMap((x) => x.variables ?? []) : [])]);
    if (taken.has(name)) {
      notify(`A variable named "${name}" already exists.`, 'error');
      return;
    }
    update((draft) => {
      const sprite = draft.sprites.find((x) => x.id === edited?.id);
      if (answer.scope === 'local' && sprite) sprite.variables = [...(sprite.variables ?? []), name];
      else draft.variables = [...globalVariables(draft), name];
    });
  };

  /** "Make a Skill": asks for a name and places a "skill" block in the workspace. */
  const makeSkill = async () => {
    const ws = wsRef.current;
    const answer = await askUser({ title: 'Make a Skill', label: 'What is the skill called?' });
    const name = answer?.value.trim();
    if (!ws || !name) return;
    if (procedureNames(menuContext()).includes(name)) {
      useStore.getState().notify(`A skill called "${name}" already exists.`, 'error');
      return;
    }
    const block = ws.newBlock('pr_define');
    block.setFieldValue(name, 'NAME');
    block.initSvg();
    block.render();
    const view = ws.getMetricsManager().getViewMetrics(true);
    const x = view.left + 32;
    let y = view.top + 32;
    const size = block.getHeightWidth();
    for (const other of ws.getTopBlocks(false)) {
      if (other === block) continue;
      const r = other.getBoundingRectangle();
      if (r.left < x + size.width && r.right > x && r.top < y + size.height && r.bottom > y) y = r.bottom + 32;
    }
    block.moveBy(x, y);
    ws.scrollBoundsIntoView(block.getBoundingRectangle());
  };

  // Create the workspace once.
  useEffect(() => {
    registerBlockly();
    const initial = toolboxFor(paletteContext());
    paletteKey.current = JSON.stringify(initial);
    const ws = Blockly.inject(divRef.current!, {
      renderer: 'amble',
      theme: AMBLE_THEME,
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      toolbox: initial,
      plugins: {
        flyoutsVerticalToolbox: 'AmbleFlyout',
        metricsManager: 'ContinuousMetrics',
        toolbox: 'AmbleToolbox',
      },
      zoom: { controls: false, wheel: true, pinch: true, startScale: BLOCK_SCALE, maxScale: 3, minScale: 0.3, scaleSpeed: 1.2 },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: false,
      sounds: false,
      comments: true,
      grid: { spacing: 40, length: 2, colour: '#ddd', snap: false },
    });
    wsRef.current = ws;
    loadedId.current = null;
    (window as unknown as { __ambleWorkspace?: Blockly.WorkspaceSvg }).__ambleWorkspace = ws;
    const removeZoom = addZoomControls(ws);
    ws.registerButtonCallback(MAKE_VARIABLE, () => void makeVariable());
    ws.registerButtonCallback(MAKE_SKILL, () => void makeSkill());

    setMenuHost({
      context: menuContext,
      newMessage: async () => {
        const name = (await askUser({ title: 'New Message', label: 'New message name:' }))?.value.trim();
        if (!name) return null;
        if (!newMessages.current.includes(name)) newMessages.current = [...newMessages.current, name];
        schedulePalette();
        return name;
      },
      renameVariable: (from) => {
        void askUser({ title: 'Rename Variable', label: `Rename all "${from}" variables to:`, defaultValue: from }).then((answer) => {
          const to = answer?.value.trim();
          if (!to || to === from) return;
          const s = useStore.getState();
          const edited = loadedId.current ? findTarget(s.project, loadedId.current) : null;
          if (variablesFor(s.project, edited).includes(to)) {
            s.notify(`A variable named "${to}" already exists.`, 'error');
            return;
          }
          renameVariable(loadedId.current, from, to);
        });
      },
      deleteVariable: (name) => {
        // Like Scratch: the variable goes, with every block in this sprite that uses it.
        Blockly.Events.setGroup(true);
        for (const block of ws.getAllBlocks(false)) {
          const uses = block.inputList.some((i) => i.fieldRow.some((f) => fieldKind(block, f) === 'variable' && f.getValue() === name));
          if (uses && !block.isDeadOrDying()) block.dispose(true, true);
        }
        Blockly.Events.setGroup(false);
        flushSave();
        deleteVariable(loadedId.current, name);
      },
      recordSound: () => {
        const s = useStore.getState();
        s.setTab('sounds');
        s.setRecording(true);
      },
    });

    registerLiveBlocks({
      flush: flushSave,
      targetId: () => loadedId.current,
      renameMenus,
    });

    ws.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent || loading.current || !loadedId.current) return;
      liveCache.current = null;
      // Renaming a custom block renames the blocks that run it.
      if (e.type === Blockly.Events.BLOCK_CHANGE) {
        const change = e as Blockly.Events.BlockChange;
        const block = change.blockId ? ws.getBlockById(change.blockId) : null;
        if (block?.type === 'pr_define' && change.element === 'field' && change.name === 'NAME' && typeof change.oldValue === 'string') {
          const from = change.oldValue.trim();
          const to = String(change.newValue ?? '').trim();
          Blockly.Events.setGroup(change.group || true);
          for (const call of ws.getBlocksByType('pr_call', false)) if (call.getFieldValue('NAME') === from && to) call.setFieldValue(to, 'NAME');
          Blockly.Events.setGroup(false);
        }
      }
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, 250);
      schedulePalette();
    });
    const ro = new ResizeObserver(() => Blockly.svgResize(ws));
    ro.observe(divRef.current!);
    // The palette follows the project: costumes, sounds, sprites, variables, world mode, the selected target.
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.project !== prev.project || state.selectedId !== prev.selectedId) {
        schedulePalette();
        refreshPictures();
      }
    });
    return () => {
      unsubscribe();
      ro.disconnect();
      flushSave();
      setMenuHost(null);
      registerLiveBlocks(null);
      removeZoom();
      if (paletteTimer.current !== null) window.clearTimeout(paletteTimer.current);
      ws.dispose();
      wsRef.current = null;
      loadedId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected target's scripts.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const replaced = shownLoad.current !== projectLoads;
    if (!replaced && loadedId.current === (target?.id ?? null)) return;
    flushSave();
    shownLoad.current = projectLoads;
    loading.current = true;
    Blockly.Events.disable();
    try {
      ws.clear();
      if (target?.blocks) Blockly.serialization.workspaces.load(target.blocks, ws);
    } catch (err) {
      console.warn('Could not load blocks', err);
    } finally {
      Blockly.Events.enable();
      loading.current = false;
    }
    ws.clearUndo();
    loadedId.current = target?.id ?? null;
    liveCache.current = null;
    refreshPalette();
    needsScroll.current = true;
    if (visibleRef.current) showScripts(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, target?.id, projectLoads]);

  useEffect(() => {
    visibleRef.current = visible;
    const ws = wsRef.current;
    if (!visible || !ws) return;
    Blockly.svgResize(ws);
    if (needsScroll.current) showScripts(ws);
  }, [visible]);

  return (
    <div className="blocks-editor" style={{ display: visible ? undefined : 'none' }}>
      <div ref={divRef} className="blockly-host" />
      {watermark && (
        <div className="sprite-watermark" aria-hidden="true">
          <img src={watermark} alt="" draggable={false} />
        </div>
      )}
      {compiledSprite && (
        <div className="compiled-overlay">
          <div className="compiled-card">
            <h3>{compiledSprite.sprite.name} was made by the compiler</h3>
            <p>{compiledSprite.sprite.description || 'The compiler added this sprite because your game needed it.'}</p>
            <p className="muted small">It has no blocks; its behavior is in the compiled code. Keep it to make it yours and add blocks.</p>
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  useStore.getState().setOutputTab('code');
                  useStore.getState().setProblemsOpen(true);
                }}
              >
                <CodeIcon size={15} /> View code
              </button>
              <button className="btn primary" onClick={() => keepCompiledSprite(compiledSprite.sprite.id)}>
                <KeepIcon size={15} /> Keep as my sprite
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
