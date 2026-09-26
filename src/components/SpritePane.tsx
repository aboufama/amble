import type { ReactElement } from 'react';
import { useState } from 'react';
import { findCompiledSprite, findTarget, useStore } from '../store';
import { ambleCostumes, newSprite } from '../project/defaults';
import { importImageFile, importModelFile, pickFile } from '../project/importers';
import { uniqueName, uid } from '../project/ids';
import type { CostumeAsset, CompiledAsset, SpriteTarget } from '../project/types';
import { BrushIcon, CopyIcon, CubeIcon, PlusIcon, SparkIcon, TrashIcon, UploadIcon } from './icons';

export function costumeThumb(c: CostumeAsset | CompiledAsset | undefined): ReactElement {
  if (!c) return <div className="thumb empty" />;
  if (c.kind === 'image') return <img className="thumb" src={c.dataUrl} alt="" draggable={false} />;
  if (c.kind === 'model') return c.thumbnail ? <img className="thumb" src={c.thumbnail} alt="" /> : <div className="thumb model"><CubeIcon size={28} /></div>;
  return <div className="thumb empty" />;
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange(v: number): void; step?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

function SpriteInfo({ sprite }: { sprite: SpriteTarget }) {
  const update = useStore((s) => s.update);
  const mode = useStore((s) => s.project.mode);
  const sprites = useStore((s) => s.project.sprites);
  const names = sprites.map((x) => x.name);
  const set = (fn: (s: SpriteTarget) => void) =>
    update((p) => {
      const t = p.sprites.find((x) => x.id === sprite.id);
      if (t) fn(t);
    });
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  return (
    <div className="sprite-info">
      <div className="row">
        <label className="text-field grow">
          <span>Sprite</span>
          <input
            value={nameDraft ?? sprite.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const v = (nameDraft ?? '').trim();
              if (v && v !== sprite.name) set((t) => (t.name = uniqueName(v, names.filter((n) => n !== sprite.name))));
              setNameDraft(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className="toggle" title="Visible when the game starts">
          <input type="checkbox" checked={sprite.visible} onChange={(e) => set((t) => (t.visible = e.target.checked))} />
          <span>Show</span>
        </label>
      </div>
      <div className="row">
        <NumberField label="x" value={sprite.x} onChange={(v) => set((t) => (t.x = v))} step={mode === '3d' ? 0.5 : 10} />
        <NumberField label="y" value={sprite.y} onChange={(v) => set((t) => (t.y = v))} step={mode === '3d' ? 0.5 : 10} />
        {mode === '3d' && <NumberField label="z" value={sprite.z} onChange={(v) => set((t) => (t.z = v))} step={0.5} />}
        <NumberField label="Size" value={sprite.size} onChange={(v) => set((t) => (t.size = Math.max(1, v)))} step={10} />
        <NumberField label={mode === '3d' ? 'Heading' : 'Angle'} value={sprite.direction} onChange={(v) => set((t) => (t.direction = v))} step={15} />
      </div>
      <label className="text-field">
        <span>What is this sprite? (optional, helps the AI)</span>
        <textarea
          rows={2}
          value={sprite.description}
          placeholder="e.g. the player, a little fox who can double-jump"
          onChange={(e) => set((t) => (t.description = e.target.value))}
        />
      </label>
    </div>
  );
}

function StageInfo() {
  const notes = useStore((s) => s.project.notes);
  const update = useStore((s) => s.update);
  return (
    <div className="sprite-info">
      <label className="text-field">
        <span>Describe your game (optional, the AI reads this first)</span>
        <textarea
          rows={3}
          value={notes}
          placeholder="e.g. A cozy platformer where a fox collects acorns before winter. 3 levels, getting harder."
          onChange={(e) => update((p) => void (p.notes = e.target.value))}
        />
      </label>
    </div>
  );
}

/** Sprite list, sprite properties, and the stage selector (bottom right, like Scratch). */
export function SpritePane() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const setTab = useStore((s) => s.setTab);
  const notify = useStore((s) => s.notify);
  const [menu, setMenu] = useState(false);
  const selected = findTarget(project, selectedId);
  const compiledSel = selected ? null : findCompiledSprite(project, selectedId);
  const mode = project.mode;

  const addSprite = (sprite: SpriteTarget, tab: 'code' | 'costumes' = 'code') => {
    update((p) => void p.sprites.push(sprite));
    select(sprite.id);
    setTab(tab);
    setMenu(false);
  };
  const names = project.sprites.map((s) => s.name);

  const paintNew = () => {
    const s = newSprite(uniqueName('Sprite1', names), mode, [], 0, 0);
    s.costumes = [
      {
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
      },
    ];
    addSprite(s, 'costumes');
  };
  const upload = async () => {
    setMenu(false);
    const files = await pickFile('image/*');
    if (!files.length) return;
    try {
      const costume = await importImageFile(files[0]);
      addSprite(newSprite(uniqueName(costume.name, names), mode, [costume]));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const uploadModel = async () => {
    setMenu(false);
    const files = await pickFile('.glb');
    if (!files.length) return;
    try {
      const model = await importModelFile(files[0]);
      addSprite(newSprite(uniqueName(model.name, names), mode, [model]));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const addAmble = () => addSprite(newSprite(uniqueName('Amble', names), mode, ambleCostumes()));

  const duplicate = (id: string) => {
    const src = project.sprites.find((s) => s.id === id);
    if (!src) return;
    const copy: SpriteTarget = JSON.parse(JSON.stringify(src));
    copy.id = uid('t');
    copy.name = uniqueName(src.name, names);
    copy.x += mode === '3d' ? 1 : 20;
    copy.costumes.forEach((c) => (c.id = uid('a')));
    copy.sounds.forEach((c) => (c.id = uid('a')));
    addSprite(copy);
  };
  const remove = (id: string) => {
    const s = project.sprites.find((x) => x.id === id);
    if (!s || !confirm(`Delete sprite "${s.name}"?`)) return;
    update((p) => {
      p.sprites = p.sprites.filter((x) => x.id !== id);
    });
    if (selectedId === id) select(project.sprites.find((x) => x.id !== id)?.id ?? project.stage.id);
  };

  const backdrop = project.stage.costumes[project.stage.currentCostume];
  const compiledSprites = (project.compiled?.mode === mode ? project.compiled?.sprites : [])?.filter((s) => !names.includes(s.name)) ?? [];

  return (
    <div className="sprite-pane">
      <div className="sprite-pane-main">
        {selected?.kind === 'sprite' && <SpriteInfo sprite={selected} />}
        {selected?.kind === 'stage' && <StageInfo />}
        {compiledSel && (
          <div className="sprite-info compiled-note">
            <SparkIcon size={16} /> <b>{compiledSel.sprite.name}</b>&nbsp;was added by the compiler.
          </div>
        )}
        <div className="sprite-grid">
          {project.sprites.map((s) => (
            <div
              key={s.id}
              className={`sprite-tile ${s.id === selectedId ? 'selected' : ''}`}
              onClick={() => select(s.id)}
              title={s.name}
            >
              {costumeThumb(s.costumes[s.currentCostume])}
              <span className="name">{s.name}</span>
              {s.id === selectedId && (
                <div className="tile-actions">
                  <button title="Duplicate" onClick={(e) => (e.stopPropagation(), duplicate(s.id))}>
                    <CopyIcon size={12} />
                  </button>
                  <button title="Delete" onClick={(e) => (e.stopPropagation(), remove(s.id))}>
                    <TrashIcon size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {compiledSprites.map((s) => {
            const look = project.compiled!.assets.find((a) => a.targetId === s.id && a.kind !== 'sound');
            return (
              <div key={s.id} className={`sprite-tile compiled ${s.id === selectedId ? 'selected' : ''}`} onClick={() => select(s.id)} title={`${s.name} (made by the compiler)`}>
                {costumeThumb(look)}
                <span className="name">{s.name}</span>
                <span className="ai-badge" title="Compiled asset">
                  <SparkIcon size={11} />
                </span>
              </div>
            );
          })}
          <div className="add-sprite">
            <button className="round-add" title="Add a sprite" onClick={() => setMenu((m) => !m)}>
              <PlusIcon size={22} />
            </button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={paintNew}>
                  <BrushIcon size={15} /> Paint
                </button>
                <button onClick={() => void upload()}>
                  <UploadIcon size={15} /> Upload image
                </button>
                {mode === '3d' && (
                  <button onClick={() => void uploadModel()}>
                    <CubeIcon size={15} /> Upload 3D model (.glb)
                  </button>
                )}
                <button onClick={addAmble}>
                  <PlusIcon size={15} /> Amble
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={`stage-selector ${selectedId === project.stage.id ? 'selected' : ''}`} onClick={() => select(project.stage.id)}>
        <span className="label">Stage</span>
        {backdrop ? costumeThumb(backdrop) : <div className="thumb sky" />}
        <span className="small muted">
          {project.stage.costumes.length} backdrop{project.stage.costumes.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
