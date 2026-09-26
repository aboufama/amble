import { useState } from 'react';
import { compiledAssetsFor, findCompiledSprite, findTarget, useStore } from '../store';
import { deleteCompiledAsset, keepCompiledAsset } from '../actions';
import { importImageFile, importModelFile, pickFile } from '../project/importers';
import { blankBackdrop } from '../project/defaults';
import { uniqueName, uid } from '../project/ids';
import type { CompiledAsset, CostumeAsset, ImageAsset } from '../project/types';
import { PaintEditor } from './PaintEditor';
import { costumeThumb } from './SpritePane';
import { BrushIcon, CopyIcon, CubeIcon, KeepIcon, SparkIcon, TrashIcon, UploadIcon } from './icons';

function sizeLabel(c: CostumeAsset | CompiledAsset): string {
  if (c.kind === 'image') return `${Math.round(c.width / (c.resolution || 1))}×${Math.round(c.height / (c.resolution || 1))}`;
  if (c.kind === 'model') return c.recipe ? `${c.recipe.parts.length} parts` : '3D model';
  return '';
}

/** Costumes (or backdrops) of the selected sprite: yours, then the ones the compiler made. */
export function CostumesPane() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const costumeSel = useStore((s) => s.costumeSel[selectedId]);
  const selectCostume = useStore((s) => s.selectCostume);
  const update = useStore((s) => s.update);
  const notify = useStore((s) => s.notify);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const target = findTarget(project, selectedId);
  const compiledView = target ? null : findCompiledSprite(project, selectedId);
  const isStage = target?.kind === 'stage';
  const own: CostumeAsset[] = target?.costumes ?? [];
  const compiled: CompiledAsset[] = (target ? compiledAssetsFor(project, selectedId) : compiledView?.costumes ?? []).filter((a) => a.kind !== 'sound');
  const all: Array<CostumeAsset | CompiledAsset> = [...own, ...compiled];
  const current = all.find((c) => c.id === costumeSel) ?? own[target?.currentCostume ?? 0] ?? all[0] ?? null;
  const currentIsCompiled = Boolean(current && 'targetId' in current);
  const noun = isStage ? 'backdrop' : 'costume';

  const setOwn = (fn: (list: CostumeAsset[], t: NonNullable<typeof target>) => void) =>
    update((p) => {
      const t = findTarget(p, selectedId);
      if (t) fn(t.costumes, t);
    });

  const add = (asset: CostumeAsset) => {
    setOwn((list, t) => {
      asset.name = uniqueName(asset.name, list.map((c) => c.name));
      list.push(asset);
      t.currentCostume = list.length - 1;
    });
    selectCostume(selectedId, asset.id);
  };

  const paint = () => {
    if (isStage) add({ ...blankBackdrop(uniqueName('backdrop1', own.map((c) => c.name))), id: uid('a') });
    else
      add({
        id: uid('a'),
        name: 'costume1',
        kind: 'image',
        dataUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'),
        mime: 'image/svg+xml',
        width: 2,
        height: 2,
        resolution: 1,
        centerX: 1,
        centerY: 1,
      });
  };
  const upload = async () => {
    const files = await pickFile('image/*', true);
    for (const f of files) {
      try {
        add(await importImageFile(f, isStage));
      } catch (err) {
        notify((err as Error).message, 'error');
      }
    }
  };
  const uploadModel = async () => {
    const files = await pickFile('.glb');
    if (!files.length) return;
    try {
      add(await importModelFile(files[0]));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const remove = (id: string) =>
    setOwn((list, t) => {
      const i = list.findIndex((c) => c.id === id);
      if (i >= 0) list.splice(i, 1);
      t.currentCostume = Math.max(0, Math.min(t.currentCostume, list.length - 1));
    });
  const duplicate = (id: string) =>
    setOwn((list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return;
      const copy = { ...list[i], id: uid('a'), name: uniqueName(list[i].name, list.map((c) => c.name)) };
      list.splice(i + 1, 0, copy);
    });

  if (!target && !compiledView) return <div className="pane-empty">Select a sprite.</div>;

  return (
    <div className="assets-pane">
      <div className="asset-list">
        {own.map((c, i) => (
          <div
            key={c.id}
            className={`asset-tile ${current?.id === c.id ? 'selected' : ''}`}
            onClick={() => {
              selectCostume(selectedId, c.id);
              setOwn((_, t) => void (t.currentCostume = i));
            }}
          >
            <span className="index">{i + 1}</span>
            {costumeThumb(c)}
            <span className="name">{c.name}</span>
            <span className="meta">{sizeLabel(c)}</span>
            {current?.id === c.id && (
              <div className="tile-actions">
                <button title="Duplicate" onClick={(e) => (e.stopPropagation(), duplicate(c.id))}>
                  <CopyIcon size={12} />
                </button>
                <button title="Delete" onClick={(e) => (e.stopPropagation(), remove(c.id))}>
                  <TrashIcon size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
        {compiled.length > 0 && (
          <div className="compiled-heading">
            <SparkIcon size={13} /> Compiled
          </div>
        )}
        {compiled.map((c) => (
          <div key={c.id} className={`asset-tile compiled ${current?.id === c.id ? 'selected' : ''}`} onClick={() => selectCostume(selectedId, c.id)}>
            {costumeThumb(c)}
            <span className="name">{c.name}</span>
            <span className="meta">{sizeLabel(c)}</span>
            <span className="ai-badge">
              <SparkIcon size={11} />
            </span>
          </div>
        ))}
        {target && (
          <div className="asset-add">
            <button title={`Paint a new ${noun}`} onClick={paint}>
              <BrushIcon size={16} />
            </button>
            <button title={`Upload a ${noun}`} onClick={() => void upload()}>
              <UploadIcon size={16} />
            </button>
            {project.mode === '3d' && !isStage && (
              <button title="Upload a 3D model (.glb)" onClick={() => void uploadModel()}>
                <CubeIcon size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="asset-detail">
        {!current && (
          <div className="pane-empty">
            No {noun}s yet. {target ? 'Paint or upload one.' : ''}
          </div>
        )}
        {current && (
          <>
            <div className="asset-header">
              {currentIsCompiled ? (
                <span className="compiled-title">
                  <SparkIcon size={14} /> {current.name}
                </span>
              ) : (
                <input
                  className="name-input"
                  value={nameDraft ?? current.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    const v = (nameDraft ?? '').trim();
                    if (v && v !== current.name) {
                      setOwn((list) => {
                        const c = list.find((x) => x.id === current.id);
                        if (c) c.name = uniqueName(v, list.filter((x) => x.id !== current.id).map((x) => x.name));
                      });
                    }
                    setNameDraft(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              )}
              {currentIsCompiled && target && (
                <>
                  <button className="btn primary small" onClick={() => keepCompiledAsset(current.id)} title="Move it into your own costumes">
                    <KeepIcon size={14} /> Keep
                  </button>
                  <button className="btn small" onClick={() => deleteCompiledAsset(current.id)} title="Delete (the next compile may make a new one)">
                    <TrashIcon size={14} />
                  </button>
                </>
              )}
            </div>
            {currentIsCompiled ? (
              <div className="compiled-preview">
                {current.kind === 'image' ? <img src={current.dataUrl} alt={current.name} /> : <div className="model-preview"><CubeIcon size={64} /></div>}
                <p>
                  <b>Made by the compiler:</b> {(current as CompiledAsset).request}
                </p>
                <p className="muted small">Keep it to make it yours (you can then edit it). Compiled assets are reused by later compiles.</p>
              </div>
            ) : current.kind === 'image' ? (
              <PaintEditor
                asset={current as ImageAsset}
                isBackdrop={isStage}
                onChange={(patch) =>
                  setOwn((list) => {
                    const c = list.find((x) => x.id === current.id);
                    if (c) Object.assign(c, patch);
                  })
                }
              />
            ) : (
              <div className="compiled-preview">
                <div className="model-preview">
                  <CubeIcon size={64} />
                </div>
                <p>3D model{current.dataUrl ? ' (uploaded .glb)' : ''}. It shows up in the 3D stage.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
