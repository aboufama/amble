/**
 * **A blob ▾** (§2.3): what the creature is, as the kind picker every screen shares (the six kinds and
 * which way it looks). Each choice re-rigs the drawing at once; the card stays open so kind and facing
 * can both be set. It follows the magic and never gates it.
 */
import { kindPhrase } from '../../bones/kindWords';
import type { CharacterKind, Facing } from '../../model/types';
import { cx } from '../../ui/cx';
import { KindPicker } from '../bones/KindPicker';

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
      <KindPicker compact value={kind} facing={facing} onChange={onChange} className="first-kind__pill" />
    </span>
  );
}
