/**
 * "It looks like you typed personal info…" under a field (§2.8, §5.13; M5): **Remove it** takes the
 * flagged spans out; middle and high school also get **Send anyway** (elementary blocks sending until the
 * info is gone). Used under the Ask field and M1's idea box.
 */
import { t } from '../../i18n';
import type { SafetyVerdict } from '../../model/types';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/icons';
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

/** The text without the flagged spans (and the spaces they leave behind). */
export function withoutSpans(text: string, spans: ReadonlyArray<readonly [number, number]>): string {
  let out = '';
  let at = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a < at) continue;
    out += text.slice(at, a);
    at = Math.max(at, b);
  }
  out += text.slice(at);
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

export function PiiWarning({ text, verdict, onRemove, onSendAnyway, id }: PiiWarningProps) {
  return (
    <div className="ai-pii" data-testid="ai-pii" id={id}>
      <p className="ai-pii__text" role="status">
        <Icon name="warning" size={16} /> {t('ai.piiWarning')}
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
