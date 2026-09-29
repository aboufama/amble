/**
 * What an AI request can carry, one line each (src/pipeline/sent.ts), as the privacy notice and the AI
 * helper's instructions page show it. tests/school/privacySent.test.ts keeps it complete.
 */
import { t } from '../../i18n';
import { SENT_LINES } from '../../pipeline/sent';
import { Prose } from './Prose';

export function SentList() {
  return (
    <div data-testid="sent-list">
      <Prose text={SENT_LINES.map((key) => `- ${t(key)}`).join('\n')} />
    </div>
  );
}
