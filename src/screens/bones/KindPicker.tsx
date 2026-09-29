/**
 * "What is it?" (§2.3, §2.11; M4 owns, M1 and M3 use it): a paper pill with the kind's pictogram and
 * words ("A person, facing you ▾") that opens a card with the six kinds and the three ways to look.
 * Picking applies at once and the card stays open, so kind and facing can both be set; Esc, Done or a
 * click outside closes it. Both groups are radio groups with arrow keys (roving tabindex).
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { CHARACTER_KINDS, type CharacterKind } from '../../cores/rig';
import type { Facing } from '../../model/types';
import { Button, KindIcon, Popover, kindWord } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { rovingIndex } from '../../ui/a11y';
import { cx } from '../../ui/cx';
import { facingPhrase, kindPhrase } from '../../bones/kindWords';
import './kindPicker.css';

export interface KindPickerProps {
  value: CharacterKind;
  facing: Facing;
  onChange(kind: CharacterKind, facing: Facing): void;
  /** A smaller pill with the kind only (the First page's chips). */
  compact?: boolean;
  /** Controlled open state (Bones opens it when no bones could be found). */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** No kind chosen yet: the pill asks "What is it?". */
  unset?: boolean;
  disabled?: boolean;
  className?: string;
}

const FACINGS: readonly Facing[] = ['viewer', 'right', 'left'];

function lookWord(f: Facing): string {
  return t(f === 'right' ? 'bones.lookRight' : f === 'left' ? 'bones.lookLeft' : 'bones.lookYou');
}

export function KindPicker({ value, facing, onChange, compact = false, open, onOpenChange, unset = false, disabled, className }: KindPickerProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = (o: boolean) => {
    setOwnOpen(o);
    onOpenChange?.(o);
  };
  const pill = useRef<HTMLButtonElement>(null);
  const kindRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lookRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const titleId = useId();
  const lookId = useId();

  const label = unset ? t('bones.kindAsk') : compact ? kindPhrase(value) : t('bones.kindPill', { kind: kindPhrase(value), facing: facingPhrase(facing) });
  const aria = unset ? t('bones.kindAsk') : t('bones.kindPillLabel', { kind: kindPhrase(value), facing: facingPhrase(facing) });

  const onKindKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingIndex(e.key, i, CHARACTER_KINDS.length, 'both');
    if (next === null) return;
    e.preventDefault();
    kindRefs.current[next]?.focus();
    onChange(CHARACTER_KINDS[next], facing);
  };

  const onLookKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingIndex(e.key, i, FACINGS.length, 'both');
    if (next === null) return;
    e.preventDefault();
    lookRefs.current[next]?.focus();
    onChange(value, FACINGS[next]);
  };

  return (
    <>
      <button
        ref={pill}
        type="button"
        className={cx('kind-pill', compact && 'kind-pill--compact', unset && 'kind-pill--unset', className)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={aria}
        disabled={disabled}
        onClick={() => setOpen(!isOpen)}
      >
        <span className="kind-pill__pic" aria-hidden="true">
          {unset ? <Icon name="bones" size={compact ? 18 : 22} /> : <KindIcon kind={value} size={compact ? 18 : 22} />}
        </span>
        <span className="kind-pill__text">{label}</span>
        <svg className="kind-pill__caret" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <Popover open={isOpen} anchor={pill.current} onClose={() => setOpen(false)} label={t('bones.kindAsk')} placement="bottom" className="kind-card">
        <div className="kind-card__head">
          <h2 id={titleId} className="kind-card__title">
            {t('bones.kindAsk')}
          </h2>
          <span className="kind-card__hint">{t('bones.kindHint')}</span>
        </div>
        <div role="radiogroup" aria-labelledby={titleId} className="kind-card__kinds">
          {CHARACTER_KINDS.map((kind, i) => {
            const on = !unset && kind === value;
            return (
              <button
                key={kind}
                ref={(el) => {
                  kindRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (unset && i === 0) ? 0 : -1}
                className={cx('kind-tile', on && 'kind-tile--on')}
                onClick={() => onChange(kind, facing)}
                onKeyDown={(e) => onKindKey(e, i)}
              >
                <KindIcon kind={kind} size={28} />
                <span>{kindWord(kind)}</span>
              </button>
            );
          })}
        </div>
        <p id={lookId} className="kind-card__sub">
          {t('bones.lookAsk')}
        </p>
        <div role="radiogroup" aria-labelledby={lookId} className="kind-card__looks">
          {FACINGS.map((f, i) => {
            const on = f === facing;
            return (
              <button
                key={f}
                ref={(el) => {
                  lookRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                className={cx('look-btn', on && 'look-btn--on')}
                onClick={() => onChange(value, f)}
                onKeyDown={(e) => onLookKey(e, i)}
              >
                {lookWord(f)}
              </button>
            );
          })}
        </div>
        <div className="kind-card__foot">
          <Button variant="ghost" size={38} icon="check" onClick={() => setOpen(false)}>
            {t('bones.kindDone')}
          </Button>
        </div>
      </Popover>
    </>
  );
}
