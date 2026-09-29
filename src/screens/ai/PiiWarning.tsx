/**
 * "It looks like you typed personal info…" under a field (§2.8, §5.13; M5): **Remove it** takes the
 * flagged spans out; middle and high school also get **Send anyway** (elementary blocks sending until the
 * info is gone). Used under the Ask field and M1's idea box.
 */
import { t } from '../../i18n';
import type { SafetyVerdict } from '../../model/types';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { withoutSpans } from './words';
import './ai.css';

export interface PiiWarningProps {
  text: string;
  verdict: Extract<SafetyVerdict, { kind: 'pii' }>;
  /** The text with the personal info taken out. */
  onRemove(cleaned: string): void;
  /** Middle and high school only (elementary blocks sending). */
  onSendAnyway?(): void;
  /** For `aria-describedby` on the field and the send button. */
  id?: string;
}

export function PiiWarning({ text, verdict, onRemove, onSendAnyway, id }: PiiWarningProps) {
  return (
    <div className="ai-pii" data-testid="ai-pii" id={id}>
      <p className="ai-pii__text" role="status">
        <Icon name="warning" size={16} />
        <span>{t('ai.piiWarning')}</span>
      </p>
      <div className="ai-pii__actions">
        <Button size={38} variant="paper" onClick={() => onRemove(withoutSpans(text, verdict.spans))}>
          {t('ai.piiRemove')}
        </Button>
        {!verdict.block && onSendAnyway && (
          <Button size={38} variant="ghost" onClick={onSendAnyway}>
            {t('ai.piiSendAnyway')}
          </Button>
        )}
      </div>
    </div>
  );
}
