import type { ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findCompiledSprite, findTarget, useStore } from '../store';
import { renameSprite } from '../actions';
import { blankBackdrop, newSprite } from '../project/defaults';
import { BACKDROP_LIBRARY, SPRITE_LIBRARY, type LibrarySprite } from '../project/library';
import { importImageFile, importModelFile, pickFile } from '../project/importers';
import { exportSprite, readSpriteFile } from '../project/persistence';
import { uniqueName, uid } from '../project/ids';
import type { CostumeAsset, CompiledAsset, ImageAsset, SpriteTarget } from '../project/types';
import { Library } from './Library';
import { confirmDelete } from '../prompt';
import { moveItem, useReorder } from './useReorder';
import {
  AddCharacterIcon,
  AddPictureIcon,
  AllAroundIcon,
  DontRotateIcon,
  BrushIcon,
  CubeIcon,
  EyeIcon,
  EyeOffIcon,
  HorizontalArrowsIcon,
  SearchIcon,
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
  reorder,
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
  /** Ask first, in Amble's dialog ("Delete Sprite"). */
  confirmWhat?: 'sprite' | 'costume' | 'backdrop' | 'sound';
  className?: string;
  title?: string;
  /** Drag to reorder (see useReorder); `placeholder` while this tile is the one dragged. */
  reorder?: { onPointerDown(e: React.PointerEvent<HTMLElement>): void; placeholder: boolean };
  children?: ReactNode;
}) {
  return (
    <div
      className={`${className} ${selected ? 'selected' : ''} ${compiled ? 'compiled' : ''} ${reorder?.placeholder ? 'placeholder' : ''}`}
      data-reorder={reorder ? '' : undefined}
      onPointerDown={reorder?.onPointerDown}
      title={title}
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
      {selected && onDelete && (
        <button
          className="delete-button"
          title="Delete"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            if (confirmWhat) void confirmDelete(confirmWhat, name).then((ok) => ok && onDelete());
            else onDelete();
          }}
        >
          <TrashIcon size={14} strokeWidth={2.6} />
        </button>
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
  wide,
  secondary,
  onFocus,
}: {
  label: string;
  icon?: ReactElement;
  value: number;
  onChange(v: number): void;
  step?: number;
  /** Size and Direction get Scratch's wider (4rem) field. */
  wide?: boolean;
  /** Scratch writes Size and Direction in plain text, Sprite, x and y in bold. */
  secondary?: boolean;
  onFocus?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="info-group">
      {icon && <span className="info-icon">{icon}</span>}
      <span className={`info-label ${secondary ? 'secondary' : ''}`}>{label}</span>
      <input
        className={`info-input small ${wide ? 'wide' : ''}`}
        inputMode="decimal"
        aria-label={label}
        onFocus={onFocus}
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

/** Scratch's direction (0 = up, 90 = right, clockwise) from Amble's 2D angle (0 = right, counter-clockwise). */
export function angleToDirection(angle: number): number {
  const d = ((((90 - angle) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : Math.round(d * 100) / 100;
}

export function directionToAngle(direction: number): number {
  return ((((90 - direction) % 360) + 360) % 360);
}

/** The dial in Scratch's direction popover: drag the handle to point the sprite. */
function DirectionDial({ direction, onChange }: { direction: number; onChange(direction: number): void }) {
  const size = 136;
  const c = size / 2;
  const r = 56;
  const rad = (direction * Math.PI) / 180;
  const point = (radius: number) => [c + radius * Math.sin(rad), c - radius * Math.cos(rad)];
  const [gx, gy] = point(r);
  const [hx, hy] = point(r - 12);
  const gauge = `M${c} ${c}L${c} ${c - r}A${r} ${r} 0 0 ${direction >= 0 ? 1 : 0} ${gx.toFixed(2)} ${gy.toFixed(2)}Z`;
  const aim = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const deg = Math.round((Math.atan2(e.clientX - box.left - box.width / 2, box.top + box.height / 2 - e.clientY) * 180) / Math.PI);
    onChange(deg === -180 ? 180 : deg);
  };
  return (
    <svg
      className="direction-dial"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        aim(e);
      }}
      onPointerMove={(e) => e.buttons && aim(e)}
    >
      <circle className="dial-face" cx={c} cy={c} r={r} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i * 15 * Math.PI) / 180;
        const inner = i % 6 === 0 ? r - 9 : r - 5;
        return <line key={i} className="dial-tick" x1={c + inner * Math.sin(a)} y1={c - inner * Math.cos(a)} x2={c + (r - 1) * Math.sin(a)} y2={c - (r - 1) * Math.cos(a)} />;
      })}
      <path className="dial-gauge" d={gauge} />
      <g className="dial-handle" transform={`translate(${hx.toFixed(2)} ${hy.toFixed(2)}) rotate(${direction})`}>
        <circle r={13} />
        <path d="M0-7l6 7h-3.5v6h-5v-6H-6z" />
      </g>
    </svg>
  );
}

const ROTATION_STYLES: Array<{ id: SpriteTarget['rotationStyle']; label: string; icon: ReactElement }> = [
  { id: 'all around', label: 'All Around', icon: <AllAroundIcon size={20} /> },
  { id: 'left-right', label: 'Left/Right', icon: <HorizontalArrowsIcon size={20} /> },
  { id: "don't rotate", label: "Don't Rotate", icon: <DontRotateIcon size={20} /> },
];

/** Direction, with Scratch's popover (dial and rotation style) while the field has focus. */
function DirectionField({ sprite, set }: { sprite: SpriteTarget; set(fn: (s: SpriteTarget) => void): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const direction = angleToDirection(sprite.direction);
  const point = (d: number) => set((t) => (t.direction = directionToAngle(d)));
  return (
    <div className="direction-field" ref={ref}>
      <NumberField label="Direction" secondary value={direction} onChange={point} step={15} wide onFocus={() => setOpen(true)} />
      {open && (
        <div className="direction-popover" role="dialog" aria-label="Direction">
          <DirectionDial direction={direction} onChange={point} />
          <div className="toggle-buttons rotation-styles" role="group" aria-label="Rotation style">
            {ROTATION_STYLES.map((r) => (
              <button key={r.id} aria-pressed={sprite.rotationStyle === r.id} title={r.label} aria-label={r.label} onClick={() => set((t) => (t.rotationStyle = r.id))}>
                {r.icon}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
        <NumberField label="Size" secondary value={sprite.size} onChange={(v) => set((t) => (t.size = Math.max(1, v)))} step={10} wide />
        {three ? (
          <NumberField label="Heading" secondary value={sprite.direction} onChange={(v) => set((t) => (t.direction = v))} step={15} wide />
        ) : (
          <DirectionField sprite={sprite} set={set} />
        )}
      </div>
      <label className="info-row info-about">
        <span className="info-label secondary">About</span>
        <input
          className="info-input about"
          value={sprite.description}
          placeholder="What is this sprite? (optional)"
          onChange={(e) => set((t) => (t.description = e.target.value))}
        />
      </label>
    </div>
  );
}

/**
 * With the stage selected, Scratch keeps the sprite fields in place but disabled. Amble's
 * last row holds the game's description instead of a sprite's.
 */
function StageInfo() {
  const notes = useStore((s) => s.project.notes);
  const update = useStore((s) => s.update);
  const blank = (label: string, placeholder = '', wide = false) => (
    <label className="info-group">
      <span className={`info-label ${['Size', 'Direction'].includes(label) ? 'secondary' : ''}`}>{label}</span>
      <input className={`info-input ${label === 'Sprite' ? 'name' : 'small'} ${wide ? 'wide' : ''}`} placeholder={placeholder} aria-label={label} disabled />
    </label>
  );
  return (
    <div className="sprite-info stage-info">
      <div className="info-row info-disabled">
        {blank('Sprite', 'Name')}
        <div className="info-group">
          <span className="info-icon">
            <HorizontalArrowsIcon size={18} />
          </span>
          <span className="info-label">x</span>
          <input className="info-input small" placeholder="x" aria-label="x" disabled />
        </div>
        <div className="info-group">
          <span className="info-icon">
            <VerticalArrowsIcon size={18} />
          </span>
          <span className="info-label">y</span>
          <input className="info-input small" placeholder="y" aria-label="y" disabled />
        </div>
      </div>
      <div className="info-row info-disabled">
        <div className="info-group">
          <span className="info-label secondary">Show</span>
          <div className="show-toggle" role="group" aria-label="Show">
            <button disabled aria-label="Show">
              <EyeIcon size={18} />
            </button>
            <button disabled aria-label="Hide">
              <EyeOffIcon size={18} />
            </button>
          </div>
        </div>
        {blank('Size', '', true)}
        {blank('Direction', '', true)}
      </div>
      <label className="info-row info-about info-notes">
        <span className="info-label secondary">Game</span>
        <textarea
          className="info-input notes"
          rows={2}
          value={notes}
          placeholder="Describe your game (optional). For example: a cozy platformer where a fox collects acorns before winter."
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
  const reorder = useReorder((from, to) => update((p) => moveItem(p.sprites, from, to)));
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
    const files = await pickFile('image/*,.ambsprite');
    if (!files.length) return;
    try {
      if (files[0].name.endsWith('.ambsprite')) {
        const sprite = await readSpriteFile(files[0]);
        addSprite({ ...sprite, name: uniqueName(sprite.name, names) });
        return;
      }
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
    const index = project.sprites.findIndex((x) => x.id === id);
    const removed = project.sprites[index];
    if (!removed) return;
    update((p) => {
      p.sprites = p.sprites.filter((x) => x.id !== id);
    });
    if (selectedId === id) select(project.sprites.find((x) => x.id !== id)?.id ?? project.stage.id);
    useStore.getState().setRestore({
      what: 'Sprite',
      run: () => {
        update((p) => {
          const sprite = { ...removed, name: uniqueName(removed.name, p.sprites.map((x) => x.name)) };
          p.sprites.splice(Math.min(index, p.sprites.length), 0, sprite);
        });
        select(removed.id);
      },
    });
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
            <b>{compiledSel.sprite.name}</b>&nbsp;was added by the compiler.
          </div>
        )}
        <div className="sprite-scroll">
          <div className="sprite-grid" ref={reorder.containerRef}>
            {reorder.order(project.sprites.length).map((i) => {
              const s = project.sprites[i];
              return (
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
                  reorder={{ onPointerDown: reorder.onPointerDown(i), placeholder: reorder.drag?.from === i }}
                />
              );
            })}
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
              {
                label: 'export',
                onClick: () => {
                  const sprite = project.sprites.find((x) => x.id === menu.id);
                  if (sprite) exportSprite(sprite);
                },
              },
              {
                label: 'delete',
                danger: true,
                onClick: () => {
                  const sprite = project.sprites.find((x) => x.id === menu.id);
                  if (sprite) void confirmDelete('sprite', sprite.name).then((ok) => ok && remove(sprite.id));
                },
              },
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
