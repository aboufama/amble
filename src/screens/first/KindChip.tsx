/**
 * **It's a Blob ▾** (§2.3): what the creature is. It opens the kind picker (Person, Four legs, Flies,
 * Swims, Blob, Thing, and which way it faces); choosing re-rigs the drawing in under half a second.
 * It follows the magic and never gates it.
 */
import { useRef, useState } from 'react';
import { t, type MessageKey } from '../../i18n';
import type { CharacterKind, Facing } from '../../model/types';
import { KindIcon, Popover } from '../../ui/components';
import { cx } from '../../ui/cx';
import { KindPicker } from '../bones/KindPicker';

const TEMPLATE: Record<CharacterKind, MessageKey> = {
  biped: 'home.kindTemplateBiped',
  quadruped: 'home.kindTemplateQuadruped',
  flyer: 'home.kindTemplateFlyer',
  swimmer: 'home.kindTemplateSwimmer',
  blob: 'home.kindTemplateBlob',
  object: 'home.kindTemplateObject',
};

const WORD: Record<CharacterKind, MessageKey> = {
  biped: 'home.kindWordBiped',
  quadruped: 'home.kindWordQuadruped',
  flyer: 'home.kindWordFlyer',
  swimmer: 'home.kindWordSwimmer',
  blob: 'home.kindWordBlob',
  object: 'home.kindWordObject',
};

/** "It's a Blob" as text (for announcements). */
export function kindSentence(kind: CharacterKind): string {
  return t(TEMPLATE[kind], { kind: t(WORD[kind]) });
}

export function Chevron() {
  return (
    <svg className="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.2 9.4c1.9 2 3.8 3.9 5.8 5.8 2-1.9 3.9-3.9 5.8-5.9" />
    </svg>
  );
}

export interface KindChipProps {
  kind: CharacterKind;
  facing: Facing;
  busy: boolean;
  onChange(kind: CharacterKind, facing: Facing): void;
}

export function KindChip({ kind, facing, busy, onChange }: KindChipProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [before, after] = t(TEMPLATE[kind]).split('{kind}');
  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx('paper-chip', busy && 'paper-chip--busy')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={busy || undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="kind-chip"
      >
        <KindIcon kind={kind} size={20} />
        {busy ? (
          <span>{t('home.kindChanging')}</span>
        ) : (
          <span>
            {before}
            <b>{t(WORD[kind])}</b>
            {after}
          </span>
        )}
        <Chevron />
      </button>
      <Popover open={open} anchor={button.current} onClose={() => setOpen(false)} label={t('home.kindPickerLabel')} placement="top" tone="paper" className="kind-popover">
        <p className="kind-popover__title">{t('home.kindPickerLabel')}</p>
        <KindPicker
          value={kind}
          facing={facing}
          compact
          onChange={(k, f) => {
            setOpen(false);
            onChange(k, f);
          }}
        />
      </Popover>
    </>
  );
}
