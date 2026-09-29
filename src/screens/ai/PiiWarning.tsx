/**
 * "It looks like you typed personal info…" under a field (§2.8; M5 owns). FOUNDATION-STUB: the core's
 * message and a Remove it button.
 */
import { PII_BLOCK_MESSAGE, PII_MESSAGE, scrubPii } from '../../cores/ai';
import type { SafetyVerdict } from '../../model/types';
import { t } from '../../i18n';
import { Button } from '../../ui/components';

export interface PiiWarningProps {
  text: string;
  verdict: Extract<SafetyVerdict, { kind: 'pii' }>;
  /** The text with the personal info taken out. */
  onRemove(cleaned: string): void;
  /** Middle and high school only (elementary blocks sending). */
  onSendAnyway?(): void;
}

export function PiiWarning({ text, verdict, onRemove }: PiiWarningProps) {
  return (
    <div className="stub-ai" role="alert">
      <p>{verdict.block ? PII_BLOCK_MESSAGE : PII_MESSAGE}</p>
      <Button size={38} onClick={() => onRemove(scrubPii(text))}>
        {t('common.ok')}
      </Button>
    </div>
  );
}
