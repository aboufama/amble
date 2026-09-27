import type { ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findCompiledSprite, findTarget, useStore } from '../store';
import { renameSprite } from '../actions';
import { blankBackdrop, newSprite } from '../project/defaults';
import { BACKDROP_LIBRARY, SPRITE_LIBRARY, type LibrarySprite } from '../project/library';
import { importImageFile, importModelFile, pickFile } from '../project/importers';
import { uniqueName, uid } from '../project/ids';
import type { CostumeAsset, CompiledAsset, ImageAsset, SpriteTarget } from '../project/types';
import { Library } from './Library';
import {
  AddCharacterIcon,
  AddPictureIcon,
  BrushIcon,
  CubeIcon,
  EyeIcon,
  EyeOffIcon,
  HorizontalArrowsIcon,
  SearchIcon,
  SparkIcon,
  SurpriseIcon,
  TrashIcon,
  UploadIcon,
  VerticalArrowsIcon,
} from './icons';

export function costumeThumb(c: CostumeAsset | CompiledAsset | undefined): ReactElement {
  if (!c) return <div className="thumb empty" />;
  if (c.kind === 'image') return <img className="thumb" src={c.dataUrl} alt="" draggable={false} />;
  if (c.kind === 'model') return c.thumbnail ? <img className="thumb" src={c.thumbnail} alt="" /> : <div className="thumb model"><CubeIcon size={28} /></div>;
  return <div className="thumb empty" />;
}

/** An empty costume to paint on. */
export function blankCostume(name = 'costume1'): ImageAsset {
  return {
    id: uid('a'),
    name,
    kind: 'image',
    dataUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'),
    mime: 'image/svg+xml',
    width: 2,
    height: 2,
    resolution: 1,
    centerX: 1,
    centerY: 1,
  };
}

// -----------------------------------------------------------------------------
// Shared Scratch-style pieces: action menus, context menus, delete prompts, tiles
// -----------------------------------------------------------------------------

export interface ActionItem {
  label: string;
  icon: ReactElement;
  onClick(): void;
}

/**
 * Scratch's round "add" button: click it for the main action; hover it and more
 * buttons slide up, each with a green label.
 */
export function ActionMenu({ title, icon, onClick, items, className = '' }: { title: string; icon: ReactElement; onClick(): void; items: ActionItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  // The hovered button's label, and its center measured from the menu's bottom edge.
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const enter = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setTip(null);
    timer.current = window.setTimeout(() => setOpen(false), 300);
  };
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const button = (label: string, content: ReactElement, cls: string, y: number, action: () => void) => (
    <button
      key={label}
      className={`action-button ${cls}`}
      aria-label={label}
      onMouseEnter={() => setTip({ label, y })}
      onMouseLeave={() => setTip((t) => (t?.label === label ? null : t))}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        setTip(null);
        action();
      }}
    >
      {content}
    </button>
  );
  return (
    <div className={`action-menu ${open ? 'expanded' : ''} ${className}`} onMouseEnter={enter} onMouseLeave={leave} onClick={(e) => e.stopPropagation()}>
      <div className="action-more">
        <div className="action-more-buttons">
          {items.map((item, i) => button(item.label, item.icon, 'action-more-button', 44 + (items.length - 1 - i) * 36 + 18, item.onClick))}
        </div>
      </div>
      {button(title, icon, 'action-main-button', 22, onClick)}
      {tip && (open || tip.y === 22) && (
        <span className="action-tip" role="tooltip" style={{ bottom: tip.y }}>
          {tip.label}
        </span>
      )}
    </div>
  );
}

export interface ContextMenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
}

/** Scratch's right-click menu for sprites, costumes and sounds. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: ContextMenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  // Keep the menu on screen: open it upward or leftward near the window's edges.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({
      x: at.x + box.width > window.innerWidth - 4 ? Math.max(4, at.x - box.width) : at.x,
      y: at.y + box.height > window.innerHeight - 4 ? Math.max(4, at.y - box.height) : at.y,
    });
  }, [at]);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div className="context-menu" role="menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Scratch's "Are you sure you want to delete this sprite?" bubble, beside the tile it asks about. */
export function DeletePrompt({ what, anchor, onYes, onNo }: { what: string; anchor: DOMRect; onYes(): void; onNo(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onNo();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onNo();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
    };
  }, [onNo]);
  const width = 264;
  const right = anchor.right + 14 + width < window.innerWidth;
  const left = right ? anchor.right + 14 : anchor.left - 14 - width;
  const top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - 70, window.innerHeight - 180));
  const arrowTop = anchor.top + anchor.height / 2 - top;
  return createPortal(
    <div
      className={`delete-prompt ${right ? 'on-right' : 'on-left'}`}
      ref={ref}
      role="alertdialog"
      aria-label={`Delete this ${what}?`}
      style={{ left, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="delete-prompt-arrow" style={{ top: arrowTop }} />
      <div className="delete-prompt-body">
        <div className="delete-prompt-label">Are you sure you want to delete this {what}?</div>
        <div className="delete-prompt-buttons">
          <button className="yes" autoFocus onClick={onYes}>
            <TrashIcon size={18} strokeWidth={2.4} /> yes
          </button>
          <button className="no" onClick={onNo}>
            no
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A tile in Scratch's sprite, costume and sound lists. */
export function AssetTile({
  name,
  details,
  number,
  image,
  selected,
  compiled,
  onSelect,
  onDelete,
  onContextMenu,
  confirmWhat,
  className = '',
  title,
  children,
}: {
  name: string;
  details?: string;
  number?: number;
  image: ReactNode;
  selected: boolean;
  compiled?: boolean;
  onSelect(): void;
  onDelete?: () => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  /** Ask "Are you sure you want to delete this ...?" first. */
  confirmWhat?: string;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  const [confirming, setConfirming] = useState<DOMRect | null>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={tileRef}
      className={`${className} ${selected ? 'selected' : ''} ${compiled ? 'compiled' : ''}`}
      title={title ?? name}
      onClick={onSelect}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {number !== undefined && <span className="tile-number">{number}</span>}
      <div className="tile-image">{image}</div>
      <div className="tile-info">
        <div className="name">{name}</div>
        {details && <div className="details">{details}</div>}
      </div>
      {compiled && (
        <span className="ai-badge" title="Made by the compiler">
          <SparkIcon size={11} />
        </span>
      )}
      {selected && onDelete && (
        <button
          className="delete-button"
          title="Delete"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            if (confirmWhat && tileRef.current) setConfirming(tileRef.current.getBoundingClientRect());
            else onDelete();
          }}
        >
          <TrashIcon size={14} strokeWidth={2.6} />
        </button>
      )}
      {confirming && confirmWhat && onDelete && (
        <DeletePrompt
          what={confirmWhat}
          anchor={confirming}
          onYes={() => {
            setConfirming(null);
            onDelete();
          }}
          onNo={() => setConfirming(null)}
        />
      )}
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sprite info
// -----------------------------------------------------------------------------

function NumberField({
  label,
  icon,
  value,
  onChange,
  step = 1,
  width,
  secondary,
}: {
  label: string;
  icon?: ReactElement;
  value: number;
  onChange(v: number): void;
  step?: number;
  width?: number;
  /** Scratch writes Size and Direction in plain text, Sprite, x and y in bold. */
  secondary?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="info-group">
      {icon && <span className="info-icon">{icon}</span>}
      <span className={`info-label ${secondary ? 'secondary' : ''}`}>{label}</span>
      <input
        className="info-input small"
        style={width ? { width } : undefined}
        inputMode="decimal"
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(Math.round((value + (e.key === 'ArrowUp' ? step : -step)) * 100) / 100);
            setDraft(null);
          }
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  );
}

function SpriteInfo({ sprite }: { sprite: SpriteTarget }) {
  const update = useStore((s) => s.update);
  const mode = useStore((s) => s.project.mode);
  const set = (fn: (s: SpriteTarget) => void) =>
    update((p) => {
      const t = p.sprites.find((x) => x.id === sprite.id);
      if (t) fn(t);
    });
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const three = mode === '3d';
  return (
    <div className="sprite-info">
      <div className="info-row">
        <label className="info-group">
          <span className="info-label">Sprite</span>
          <input
            className="info-input name"
            aria-label="Sprite name"
            value={nameDraft ?? sprite.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const v = (nameDraft ?? '').trim();
              if (v && v !== sprite.name) renameSprite(sprite.id, v);
              setNameDraft(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <NumberField label="x" icon={three ? undefined : <HorizontalArrowsIcon size={18} />} value={sprite.x} onChange={(v) => set((t) => (t.x = v))} step={three ? 0.5 : 10} />
        <NumberField label="y" icon={three ? undefined : <VerticalArrowsIcon size={18} />} value={sprite.y} onChange={(v) => set((t) => (t.y = v))} step={three ? 0.5 : 10} />
        {three && <NumberField label="z" value={sprite.z} onChange={(v) => set((t) => (t.z = v))} step={0.5} />}
      </div>
      <div className="info-row">
        <div className="info-group">
          <span className="info-label secondary">Show</span>
          <div className="show-toggle" role="group" aria-label="Show">
            <button aria-pressed={sprite.visible} title="Show" aria-label="Show" onClick={() => set((t) => (t.visible = true))}>
              <EyeIcon size={18} />
            </button>
            <button aria-pressed={!sprite.visible} title="Hide" aria-label="Hide" onClick={() => set((t) => (t.visible = false))}>
              <EyeOffIcon size={18} />
            </button>
          </div>
        </div>
        <NumberField label="Size" secondary value={sprite.size} onChange={(v) => set((t) => (t.size = Math.max(1, v)))} step={10} width={64} />
        <NumberField label={three ? 'Heading' : 'Direction'} secondary value={sprite.direction} onChange={(v) => set((t) => (t.direction = v))} step={15} width={64} />
      </div>
      <label className="info-row info-about">
        <span className="info-label secondary">About</span>
        <input
          className="info-input about"
          value={sprite.description}
          placeholder="What is this sprite? (optional, helps the AI)"
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
    <div className="sprite-info stage-info">
      <label className="info-row info-notes">
        <span className="info-label">Game</span>
        <textarea
          className="info-input notes"
          rows={3}
          value={notes}
          placeholder="Describe your game (optional, the AI reads this first). For example: a cozy platformer where a fox collects acorns before winter."
          onChange={(e) => update((p) => void (p.notes = e.target.value))}
        />
      </label>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The target pane: sprites (left) and the stage (right), like Scratch
// -----------------------------------------------------------------------------

/** Sprite list, sprite properties, and the stage selector (bottom right, like Scratch). */
export function SpritePane() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const setTab = useStore((s) => s.setTab);
  const notify = useStore((s) => s.notify);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [library, setLibrary] = useState<'sprite' | 'backdrop' | null>(null);
  const selected = findTarget(project, selectedId);
  const compiledSel = selected ? null : findCompiledSprite(project, selectedId);
  const mode = project.mode;
  const names = project.sprites.map((s) => s.name);

  const addSprite = (sprite: SpriteTarget, tab: 'code' | 'costumes' = 'code') => {
    update((p) => void p.sprites.push(sprite));
    select(sprite.id);
    setTab(tab);
  };

  const paintNew = () => addSprite(newSprite(uniqueName('Sprite1', names), mode, [blankCostume()], 0, 0), 'costumes');
  const upload = async () => {
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
    const files = await pickFile('.glb');
    if (!files.length) return;
    try {
      const model = await importModelFile(files[0]);
      addSprite(newSprite(uniqueName(model.name, names), mode, [model]));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const addFromLibrary = (item: LibrarySprite) => {
    const sprite = newSprite(uniqueName(item.name, names), mode, item.costumes());
    sprite.description = item.description;
    addSprite(sprite);
  };
  const surprise = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

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
    update((p) => {
      p.sprites = p.sprites.filter((x) => x.id !== id);
    });
    if (selectedId === id) select(project.sprites.find((x) => x.id !== id)?.id ?? project.stage.id);
  };

  // Backdrops are added from the stage selector, like Scratch.
  const addBackdrop = (make: () => Promise<ImageAsset | null> | ImageAsset | null) => async () => {
    try {
      const backdrop = await make();
      if (!backdrop) return;
      update((p) => {
        backdrop.name = uniqueName(backdrop.name, p.stage.costumes.map((c) => c.name));
        p.stage.costumes.push(backdrop);
        p.stage.currentCostume = p.stage.costumes.length - 1;
      });
      select(project.stage.id);
      useStore.getState().selectCostume(project.stage.id, backdrop.id);
      setTab('costumes');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const paintBackdrop = addBackdrop(() => ({ ...blankBackdrop('backdrop1'), id: uid('a') }));
  const libraryBackdrop = (name: string) => addBackdrop(() => BACKDROP_LIBRARY.find((b) => b.name === name)?.make() ?? null)();
  const uploadBackdrop = addBackdrop(async () => {
    const files = await pickFile('image/*');
    return files.length ? importImageFile(files[0], true) : null;
  });

  const backdrop = project.stage.costumes[project.stage.currentCostume];
  const compiledSprites = (project.compiled?.mode === mode ? project.compiled?.sprites : [])?.filter((s) => !names.includes(s.name)) ?? [];
  const spriteItems: ActionItem[] = [
    { label: 'Upload Sprite', icon: <UploadIcon size={20} strokeWidth={2.4} />, onClick: () => void upload() },
    ...(mode === '3d' ? [{ label: 'Upload 3D Model', icon: <CubeIcon size={20} strokeWidth={2.2} />, onClick: () => void uploadModel() }] : []),
    { label: 'Surprise', icon: <SurpriseIcon size={20} />, onClick: () => addFromLibrary(surprise(SPRITE_LIBRARY)) },
    { label: 'Paint', icon: <BrushIcon size={20} strokeWidth={2.4} />, onClick: paintNew },
    { label: 'Choose a Sprite', icon: <SearchIcon size={20} />, onClick: () => setLibrary('sprite') },
  ];

  return (
    <div className="target-pane">
      <div className="sprite-selector">
        {selected?.kind === 'sprite' && <SpriteInfo sprite={selected} />}
        {selected?.kind === 'stage' && <StageInfo />}
        {compiledSel && (
          <div className="sprite-info compiled-note">
            <SparkIcon size={16} /> <b>{compiledSel.sprite.name}</b>&nbsp;was added by the compiler.
          </div>
        )}
        <div className="sprite-scroll">
          <div className="sprite-grid">
            {project.sprites.map((s) => (
              <AssetTile
                key={s.id}
                className="sprite-tile"
                name={s.name}
                image={costumeThumb(s.costumes[s.currentCostume])}
                selected={s.id === selectedId}
                onSelect={() => select(s.id)}
                onDelete={() => remove(s.id)}
                confirmWhat="sprite"
                onContextMenu={(at) => setMenu({ id: s.id, at })}
              />
            ))}
            {compiledSprites.map((s) => {
              const look = project.compiled!.assets.find((a) => a.targetId === s.id && a.kind !== 'sound');
              return (
                <AssetTile
                  key={s.id}
                  className="sprite-tile"
                  compiled
                  name={s.name}
                  title={`${s.name} (made by the compiler)`}
                  image={costumeThumb(look)}
                  selected={s.id === selectedId}
                  onSelect={() => select(s.id)}
                />
              );
            })}
          </div>
        </div>
        <ActionMenu className="add-sprite" title="Choose a Sprite" icon={<AddCharacterIcon size={28} />} onClick={() => setLibrary('sprite')} items={spriteItems} />
        {menu && (
          <ContextMenu
            at={menu.at}
            onClose={() => setMenu(null)}
            items={[
              { label: 'duplicate', onClick: () => duplicate(menu.id) },
              { label: 'delete', danger: true, onClick: () => remove(menu.id) },
            ]}
          />
        )}
      </div>
      <div className={`stage-selector ${selectedId === project.stage.id ? 'selected' : ''}`} onClick={() => select(project.stage.id)} role="button" aria-label="Stage">
        <div className="stage-selector-header">
          <span className="stage-selector-title">Stage</span>
        </div>
        {backdrop ? <div className="stage-selector-thumb">{costumeThumb(backdrop)}</div> : <div className="stage-selector-thumb sky" />}
        <div className="stage-selector-label">Backdrops</div>
        <div className="stage-selector-count">{project.stage.costumes.length}</div>
        <ActionMenu
          className="add-backdrop"
          title="Choose a Backdrop"
          icon={<AddPictureIcon size={26} />}
          onClick={() => setLibrary('backdrop')}
          items={[
            { label: 'Upload Backdrop', icon: <UploadIcon size={20} strokeWidth={2.4} />, onClick: () => void uploadBackdrop() },
            { label: 'Surprise', icon: <SurpriseIcon size={20} />, onClick: () => libraryBackdrop(surprise(BACKDROP_LIBRARY).name) },
            { label: 'Paint', icon: <BrushIcon size={20} strokeWidth={2.4} />, onClick: () => void paintBackdrop() },
            { label: 'Choose a Backdrop', icon: <SearchIcon size={20} />, onClick: () => setLibrary('backdrop') },
          ]}
        />
      </div>
      {library === 'sprite' && (
        <SpriteLibrary
          onClose={() => setLibrary(null)}
          onChoose={(item) => {
            setLibrary(null);
            addFromLibrary(item);
          }}
        />
      )}
      {library === 'backdrop' && (
        <BackdropLibrary
          onClose={() => setLibrary(null)}
          onChoose={(name) => {
            setLibrary(null);
            libraryBackdrop(name);
          }}
        />
      )}
    </div>
  );
}

/** "Choose a Sprite": Amble's built-in sprites. */
export function SpriteLibrary({ onChoose, onClose }: { onChoose(item: LibrarySprite): void; onClose(): void }) {
  const items = useMemo(() => SPRITE_LIBRARY.map((item) => ({ item, preview: item.costumes()[0] })), []);
  return (
    <Library
      title="Choose a Sprite"
      onClose={onClose}
      onChoose={(name) => {
        const found = SPRITE_LIBRARY.find((s) => s.name === name);
        if (found) onChoose(found);
      }}
      items={items.map(({ item, preview }) => ({ id: item.name, name: item.name, image: <img src={preview.dataUrl} alt="" draggable={false} /> }))}
    />
  );
}

/** "Choose a Backdrop": Amble's built-in backdrops. */
export function BackdropLibrary({ onChoose, onClose }: { onChoose(name: string): void; onClose(): void }) {
  const items = useMemo(() => BACKDROP_LIBRARY.map((b) => ({ name: b.name, preview: b.make() })), []);
  return (
    <Library
      title="Choose a Backdrop"
      onClose={onClose}
      onChoose={onChoose}
      items={items.map(({ name, preview }) => ({ id: name, name, image: <img className="library-backdrop" src={preview.dataUrl} alt="" draggable={false} /> }))}
    />
  );
}
