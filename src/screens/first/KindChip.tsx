/**
 * **It's a blob ▾** (§2.3): what the creature is, as the kind picker every screen shares (the six kinds and
 * which way it looks). Each choice re-rigs the drawing at once; the card stays open so kind and facing
 * can both be set. It follows the magic and never gates it.
 */
import { kindPhrase } from '../../bones/kindWords';
import { t, type MessageKey } from '../../i18n';
import type { CharacterKind, Facing } from '../../model/types';
import { cx } from '../../ui/cx';
import { KindPicker } from '../bones/KindPicker';

/** The chip says what the creature is as a sentence: **It's a blob ▾** (§2.3). */
const IT_IS: Record<CharacterKind, MessageKey> = {
  biped: 'home.kindIsBiped',
  quadruped: 'home.kindIsQuadruped',
  flyer: 'home.kindIsFlyer',
  swimmer: 'home.kindIsSwimmer',
  blob: 'home.kindIsBlob',
  object: 'home.kindIsObject',
};

export function itIsKind(kind: CharacterKind): string {
  return t(IT_IS[kind]);
}

/** "A person" as text (for announcements). */
export function kindSentence(kind: CharacterKind): string {
  return kindPhrase(kind);
}

export interface KindChipProps {
  kind: CharacterKind;
  facing: Facing;
  busy: boolean;
  onChange(kind: CharacterKind, facing: Facing): void;
}

export function KindChip({ kind, facing, busy, onChange }: KindChipProps) {
  return (
    <span className={cx('first-kind', busy && 'first-kind--busy')} aria-busy={busy || undefined} data-testid="kind-chip">
      <KindPicker compact pillWords={itIsKind} value={kind} facing={facing} onChange={onChange} className="first-kind__pill" />
    </span>
  );
}
