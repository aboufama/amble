/**
 * "What is it?" (§2.3, §2.11; M4 owns, used by M1 and M3): the six kinds times facing. FOUNDATION-STUB:
 * a simple kind choice with the pictograms; M4 builds the real picker (a paper pill with facing arrows).
 */
import { KindIcon, kindWord } from '../../ui/components';
import type { CharacterKind, Facing } from '../../model/types';
import { CHARACTER_KINDS } from '../../cores/rig';

export interface KindPickerProps {
  value: CharacterKind;
  facing: Facing;
  onChange(kind: CharacterKind, facing: Facing): void;
  compact?: boolean;
}

export function KindPicker({ value, facing, onChange, compact = false }: KindPickerProps) {
  return (
    <div role="radiogroup" aria-label={kindWord(value)} className="stub-kind-picker">
      {CHARACTER_KINDS.map((kind) => (
        <button key={kind} type="button" role="radio" aria-checked={kind === value} className="chip chip--button" onClick={() => onChange(kind, facing)}>
          <KindIcon kind={kind} size={compact ? 16 : 20} showLabel />
        </button>
      ))}
    </div>
  );
}
