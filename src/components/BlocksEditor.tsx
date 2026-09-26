import { useEffect, useRef } from 'react';
import { AMBLE_THEME, Blockly, registerBlockly, toolboxFor } from '../blocks/blockly';
import { findCompiledSprite, findTarget, useStore } from '../store';
import { keepCompiledSprite } from '../actions';
import { CodeIcon, KeepIcon, SparkIcon } from './icons';

/** The Blockly workspace for the selected sprite (or the stage). */
export function BlocksEditor({ visible }: { visible: boolean }) {
  const divRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const loadedId = useRef<string | null>(null);
  const loading = useRef(false);
  const saveTimer = useRef<number | null>(null);
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
  const mode = useStore((s) => s.project.mode);
  const projectId = useStore((s) => s.project.id);
  const target = useStore((s) => findTarget(s.project, s.selectedId));
  const compiledSprites = useStore((s) => s.project.compiled?.sprites);
  const project = useStore.getState().project;
  const compiledSprite = target || !compiledSprites ? null : findCompiledSprite(project, selectedId);

  const flushSave = () => {
    const ws = wsRef.current;
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const id = loadedId.current;
    if (!ws || !id) return;
    const state = Blockly.serialization.workspaces.save(ws) as Record<string, unknown>;
    useStore.getState().update((p) => {
      const t = findTarget(p, id);
      if (t) t.blocks = state;
    });
  };

  // Create the workspace once.
  useEffect(() => {
    registerBlockly();
    const ws = Blockly.inject(divRef.current!, {
      renderer: 'zelos',
      theme: AMBLE_THEME,
      media: `${import.meta.env.BASE_URL}blockly-media/`,
      toolbox: toolboxFor(useStore.getState().project.mode),
      plugins: {
        flyoutsVerticalToolbox: 'ContinuousFlyout',
        metricsManager: 'ContinuousMetrics',
        toolbox: 'ContinuousToolbox',
      },
      zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2, minScale: 0.35, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
      grid: { spacing: 32, length: 2, colour: '#e4e6ee', snap: false },
    });
    wsRef.current = ws;
    loadedId.current = null;
    (window as unknown as { __ambleWorkspace?: Blockly.WorkspaceSvg }).__ambleWorkspace = ws;
    ws.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent || loading.current || !loadedId.current) return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, 250);
    });
    const ro = new ResizeObserver(() => Blockly.svgResize(ws));
    ro.observe(divRef.current!);
    return () => {
      ro.disconnect();
      flushSave();
      ws.dispose();
      wsRef.current = null;
      loadedId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the palette when switching between 2D and 3D.
  useEffect(() => {
    wsRef.current?.updateToolbox(toolboxFor(mode));
  }, [mode]);

  // Load the selected target's scripts.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (loadedId.current === (target?.id ?? null)) return;
    flushSave();
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
    loadedId.current = target?.id ?? null;
    needsScroll.current = true;
    if (visibleRef.current) showScripts(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, target?.id, projectId]);

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
      {compiledSprite && (
        <div className="compiled-overlay">
          <div className="compiled-card">
            <SparkIcon size={26} className="spark" />
            <h3>{compiledSprite.sprite.name} was made by the compiler</h3>
            <p>{compiledSprite.sprite.description || 'The AI added this sprite because your game needed it.'}</p>
            <p className="muted small">It has no blocks; its behavior is in the generated code. Keep it to make it yours and add blocks.</p>
            <div className="row">
              <button className="btn" onClick={() => useStore.getState().setOutputTab('code')}>
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
