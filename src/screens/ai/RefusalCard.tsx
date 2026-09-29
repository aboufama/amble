/**
 * "Amble can't make that one. How about one of these?" (§2.8 Refused, §5.13; M5): a paper card with a
 * kind note (real-person refusals add the sentence about real people) and two alternatives as chips.
 * Picking one puts it in the field. Used by the Ask card and by M1's idea box.
 */
import { t } from '../../i18n';
import { Chip, PaperCard } from '../../ui/components';
import './ai.css';

export interface RefusalCardProps {
  note: string;
  alternatives: string[];
  onPick(alternative: string): void;
}

export function RefusalCard({ note, alternatives, onPick }: RefusalCardProps) {
  const title = t('ai.refusedTitle');
  const extra = note.trim() && note.trim() !== title ? note.trim() : '';
  return (
    <PaperCard className="ai-paper ai-refusal" tilt={0.5} cut>
      <div role="status" data-testid="ai-refusal">
        <p className="ai-refusal__title">{title}</p>
        {extra && <p className="ai-refusal__note">{extra}</p>}
      </div>
      {alternatives.length > 0 && (
        <div className="ai-refusal__chips">
          {alternatives.slice(0, 2).map((a) => (
            <Chip key={a} icon="sparkle" onClick={() => onPick(a)}>
              {a}
            </Chip>
          ))}
        </div>
      )}
    </PaperCard>
  );
}
