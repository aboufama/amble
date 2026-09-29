/**
 * A wish that isn't for school games (§2.8 Refused, §5.13): "Let's keep it friendly.", a kind note when
 * there is one (real-person refusals add the sentence about real people), and "Try:" with two
 * alternatives as chips; picking one puts it in the field. No machine words: a note the AI wrote keeps
 * only its sentences fit for students. Used by the wish box, the idea box and the plan card.
 */
import { t } from '../../i18n';
import { Chip } from '../../ui/components';
import { kindSentences } from './words';
import './ai.css';

export interface RefusalCardProps {
  note: string;
  alternatives: string[];
  onPick(alternative: string): void;
}

export function RefusalCard({ note, alternatives, onPick }: RefusalCardProps) {
  const title = t('ai.refusedTitle');
  const kind = kindSentences(note);
  const extra = kind && kind !== title && kind !== t('ai.refusedDefault') ? kind : '';
  const tries = alternatives.slice(0, 2);
  return (
    <div className="wish-note wish-refusal">
      <div role="status" data-testid="ai-refusal">
        <p className="wish-note__title">{title}</p>
        {extra && <p className="wish-note__text">{extra}</p>}
      </div>
      {tries.length > 0 && (
        <div className="wish-refusal__try" role="group" aria-label={t('ai.refusedTry')}>
          <span className="wish-refusal__label" aria-hidden="true">
            {t('ai.refusedTry')}
          </span>
          {tries.map((a) => (
            <Chip key={a} onClick={() => onPick(a)}>
              {a}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
