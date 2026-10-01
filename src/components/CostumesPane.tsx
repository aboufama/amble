import { useMemo, useState } from 'react';
import { compiledAssetsFor, findCompiledSprite, findTarget, useStore } from '../store';
import { deleteCompiledAsset, keepCompiledAsset, renameCostume } from '../actions';
import { importImageFile, pickFile } from '../project/importers';
import { exportAsset } from '../project/persistence';
import { blankBackdrop } from '../project/defaults';
import { BACKDROP_LIBRARY, libraryCostumes } from '../project/library';
import { uniqueName, uid } from '../project/ids';
import type { CompiledAsset, CostumeAsset, ImageAsset } from '../project/types';
import { PaintEditor } from './PaintEditor';
import { ActionMenu, AssetTile, BackdropLibrary, ContextMenu, blankCostume, costumeThumb } from './SpritePane';
import { Library } from './Library';
import { confirmDelete } from '../prompt';
import { moveItem, useReorder } from './useReorder';
import { AddCharacterIcon, AddPictureIcon, BrushIcon, DiceIcon, KeepIcon, TrashIcon, UploadIcon } from './icons';

function sizeLabel(c: CostumeAsset | CompiledAsset): string {
  if (c.kind === 'image') return `${Math.round(c.width / (c.resolution || 1))}×${Math.round(c.height / (c.resolution || 1))}`;
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
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [library, setLibrary] = useState(false);
  // Reordering keeps the same costume current.
  const reorder = useReorder((from, to) =>
    setOwn((list, t) => {
      const currentId = list[t.currentCostume]?.id;
      moveItem(list, from, to);
      t.currentCostume = Math.max(0, list.findIndex((c) => c.id === currentId));
    }),
  );

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
    else add(blankCostume());
  };
  const surprise = () => {
    if (isStage) {
      add(BACKDROP_LIBRARY[Math.floor(Math.random() * BACKDROP_LIBRARY.length)].make());
      return;
    }
    const all = libraryCostumes();
    add(all[Math.floor(Math.random() * all.length)]);
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
  const remove = (id: string) => {
    const index = own.findIndex((c) => c.id === id);
    const removed = own[index];
    if (!removed) return;
    setOwn((list, t) => {
      list.splice(index, 1);
      t.currentCostume = Math.max(0, Math.min(t.currentCostume, list.length - 1));
    });
    const targetId = selectedId;
    useStore.getState().setRestore({
      what: isStage ? 'Backdrop' : 'Costume',
      run: () => {
        update((p) => {
          const t = findTarget(p, targetId);
          if (!t) return;
          t.costumes.splice(Math.min(index, t.costumes.length), 0, { ...removed, name: uniqueName(removed.name, t.costumes.map((c) => c.name)) });
        });
        useStore.getState().select(targetId);
        selectCostume(targetId, removed.id);
      },
    });
  };
  const duplicate = (id: string) =>
    setOwn((list) => {
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return;
      const copy = { ...list[i], id: uid('a'), name: uniqueName(list[i].name, list.map((c) => c.name)) };
      list.splice(i + 1, 0, copy);
    });

  if (!target && !compiledView) return <div className="pane-empty">Select a sprite.</div>;

  const Noun = isStage ? 'Backdrop' : 'Costume';
  return (
    <div className="asset-panel">
      <div className="asset-selector">
        <div className="asset-list" ref={reorder.containerRef}>
          {reorder.order(own.length).map((i, shown) => {
            const c = own[i];
            return (
              <AssetTile
                key={c.id}
                className="asset-tile"
                number={shown + 1}
                name={c.name}
                details={sizeLabel(c)}
                image={costumeThumb(c)}
                selected={current?.id === c.id}
                onSelect={() => {
                  selectCostume(selectedId, c.id);
                  setOwn((list, t) => void (t.currentCostume = Math.max(0, list.findIndex((x) => x.id === c.id))));
                }}
                onDelete={own.length > 1 || isStage ? () => remove(c.id) : undefined}
                confirmWhat={noun}
                onContextMenu={(at) => setMenu({ id: c.id, at })}
                reorder={{ onPointerDown: reorder.onPointerDown(i), placeholder: reorder.drag?.from === i }}
              />
            );
          })}
          {compiled.map((c) => (
            <AssetTile
              key={c.id}
              className="asset-tile"
              compiled
              name={c.name}
              details={sizeLabel(c)}
              image={costumeThumb(c)}
              selected={current?.id === c.id}
              onSelect={() => selectCostume(selectedId, c.id)}
            />
          ))}
        </div>
        {target && (
          <ActionMenu
            className="add-asset"
            title={`Choose a ${Noun}`}
            icon={isStage ? <AddPictureIcon size={26} /> : <AddCharacterIcon size={28} />}
            onClick={() => setLibrary(true)}
            items={[
              { label: `Upload ${Noun}`, icon: <UploadIcon size={20} strokeWidth={2.4} />, onClick: () => void upload() },
              { label: 'Surprise', icon: <DiceIcon size={20} strokeWidth={2.4} />, onClick: surprise },
              { label: 'Paint', icon: <BrushIcon size={20} strokeWidth={2.4} />, onClick: paint },
            ]}
          />
        )}
        {menu && (
          <ContextMenu
            at={menu.at}
            onClose={() => setMenu(null)}
            items={[
              { label: 'duplicate', onClick: () => duplicate(menu.id) },
              {
                label: 'export',
                onClick: () => {
                  const c = own.find((x) => x.id === menu.id);
                  if (c?.kind === 'image') void exportAsset(c).catch((err: Error) => notify(err.message, 'error'));
                },
              },
              ...(own.length > 1 || isStage
                ? [
                    {
                      label: 'delete',
                      danger: true,
                      onClick: () => {
                        const c = own.find((x) => x.id === menu.id);
                        if (c) void confirmDelete(noun, c.name).then((ok) => ok && remove(c.id));
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
      {library &&
        (isStage ? (
          <BackdropLibrary
            onClose={() => setLibrary(false)}
            onChoose={(name) => {
              setLibrary(false);
              const b = BACKDROP_LIBRARY.find((x) => x.name === name);
              if (b) add(b.make());
            }}
          />
        ) : (
          <CostumeLibrary
            onClose={() => setLibrary(false)}
            onChoose={(c) => {
              setLibrary(false);
              add(c);
            }}
          />
        ))}
      <div className="asset-detail">
        {!current && (
          <div className="pane-empty">
            No {noun}s yet. {target ? 'Paint or upload one.' : ''}
          </div>
        )}
        {current && (() => {
          const nameField = (
            <label className="info-group">
              <span className="info-label">{Noun}</span>
              <input
                className="info-input name-input"
                aria-label={`${Noun} name`}
                value={nameDraft ?? current.name}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  const v = (nameDraft ?? '').trim();
                  if (v && v !== current.name) renameCostume(selectedId, current.id, v);
                  setNameDraft(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
          );
          if (!currentIsCompiled && current.kind === 'image') {
            return (
              <PaintEditor
                asset={current as ImageAsset}
                isBackdrop={isStage}
                nameField={nameField}
                onChange={(patch) =>
                  setOwn((list) => {
                    const c = list.find((x) => x.id === current.id);
                    if (c) Object.assign(c, patch);
                  })
                }
              />
            );
          }
          return (
            <div className="asset-editor">
              <div className="editor-row">
                {currentIsCompiled ? (
                  <span className="compiled-title">
                    {current.name}
                  </span>
                ) : (
                  nameField
                )}
                {currentIsCompiled && target && (
                  <>
                    <button className="btn primary small" onClick={() => keepCompiledAsset(current.id)} title="Move it into your own costumes">
                      <KeepIcon size={14} /> Keep
                    </button>
                    <button className="btn small" onClick={() => deleteCompiledAsset(current.id)} title="Delete (a new one is made if your words still need it)">
                      <TrashIcon size={14} />
                    </button>
                  </>
                )}
              </div>
              {currentIsCompiled && (
                <div className="compiled-preview">
                  {current.kind === 'image' && <img src={current.dataUrl} alt={current.name} />}
                  {target && <p className="muted small">Added so your words work. Keep it to change it.</p>}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/** "Choose a Costume": every costume of Amble's built-in sprites. */
function CostumeLibrary({ onChoose, onClose }: { onChoose(costume: ImageAsset): void; onClose(): void }) {
  const costumes = useMemo(() => libraryCostumes(), []);
  return (
    <Library
      title="Choose a Costume"
      onClose={onClose}
      onChoose={(id) => {
        const found = costumes.find((c) => c.id === id);
        if (found) onChoose({ ...found, id: uid('a') });
      }}
      items={costumes.map((c) => ({ id: c.id, name: c.name, image: <img src={c.dataUrl} alt="" draggable={false} /> }))}
    />
  );
}
