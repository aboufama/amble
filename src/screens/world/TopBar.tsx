/**
 * The world's top bar (§2.6): ◂ Trail · the hero's sticker and the world's name (click or Enter renames
 * it, 40 characters) · the save state · Save to Drive (Hand in for an assignment) · ⋯.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TopBar } from '../../app/frame/TopBar';
import { t } from '../../i18n';
import { TEXT_LIMITS } from '../../model/limits';
import type { CastMember, World } from '../../model/types';
import { SaveButton, SaveStatus, useSaveState } from '../files/SaveButton';
import { HandInButton } from '../handin/HandInButton';
import { announce } from '../../state/app';
import { updateWorld } from '../../state/session';
import { useStore } from '../../state/store';
import { PlaceholderGlyph, Sticker } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { useLayout, useSticker } from './hooks';
import { WorldMenu, type SheetName } from './WorldMenu';

function HeroSticker({ hero }: { hero: CastMember | null }) {
  const url = useSticker(hero?.art ?? null);
  if (!hero) return null;
  const label = t('world.heroSticker', { name: hero.name });
  return (
    <span className="world-top__hero" title={label}>
      {hero.art ? <Sticker src={url} alt={label} size={38} /> : <PlaceholderGlyph rig={hero.rig} role={hero.role} shape={hero.shape} size={38} name={hero.name} />}
    </span>
  );
}

function WorldName({ world }: { world: World }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(world.title);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const finish = (save: boolean) => {
    const next = text.trim().slice(0, TEXT_LIMITS.worldTitle);
    setEditing(false);
    if (save && next && next !== world.title) {
      updateWorld((w) => {
        w.title = next;
      });
      announce(t('world.renameDone', { title: next }));
    } else setText(world.title);
    requestAnimationFrame(() => button.current?.focus());
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={input}
        className="world-top__name-input"
        aria-label={t('world.renameLabel')}
        value={text}
        maxLength={TEXT_LIMITS.worldTitle}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => finish(true)}
        data-testid="world-name-input"
      />
    );
  }
  return (
    <button
      ref={button}
      type="button"
      className="world-top__name"
      aria-label={`${world.title}. ${t('world.renameButton')}`}
      onClick={() => {
        setText(world.title);
        setEditing(true);
      }}
      data-testid="world-name"
    >
      <span className="world-top__title">{world.title}</span>
      <Icon name="draw" size={18} className="world-top__pencil" />
    </button>
  );
}

export interface WorldTopBarProps {
  world: World;
  onOpen(sheet: SheetName): void;
}

export function WorldTopBar({ world, onOpen }: WorldTopBarProps) {
  const layout = useLayout();
  const hero = useStore((s) => s.session.cast.find((m) => m.role === 'hero') ?? null);
  const save = useSaveState();
  const short = layout === 'touch' || layout === 'small' || layout === 'portrait';
  return (
    <TopBar
      className="world-top"
      aiChip={false}
      lead={<HeroSticker hero={hero} />}
      title={<WorldName world={world} />}
      actions={
        <>
          {short && save === 'saved' ? (
            <span className="save-state save-state--saved world-top__saved" data-testid="save-state" data-state="saved">
              {t('world.savedShort')}
            </span>
          ) : (
            <SaveStatus />
          )}
          {world.assignment ? <HandInButton world={world} /> : <SaveButton world={world} compact={short} />}
          <WorldMenu world={world} onOpen={onOpen} />
        </>
      }
    />
  );
}
