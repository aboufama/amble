/**
 * The AI chip in every top bar (§2.2): the AI helper's status in words with a dot ("AI helper · on
 * (SAU 99)"). It opens Settings → AI helper.
 */
import { t, type MessageKey } from '../../i18n';
import type { AiStatus } from '../../model/types';
import { useStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { cx } from '../../ui/cx';
import { Link } from '../Link';

const WORDS: Record<AiStatus, MessageKey> = {
  off: 'common.aiChipOff',
  ready: 'common.aiChipReady',
  'explain-only': 'common.aiChipExplain',
  offline: 'common.aiChipOffline',
  blocked: 'common.aiChipBlocked',
  quota: 'common.aiChipQuota',
  expired: 'common.aiChipExpired',
  rejected: 'common.aiChipRejected',
  busy: 'common.aiChipBusy',
};

function dotOf(status: AiStatus): string {
  if (status === 'ready') return 'alive';
  if (status === 'explain-only') return 'ai';
  if (status === 'off') return 'off';
  return 'warn';
}

export function AiChip({ compact = false }: { compact?: boolean }) {
  const status = useStore((s) => s.ai.status);
  const district = useStore((s) => s.config.ai?.district?.name ?? s.config.classLink?.district ?? null);
  const text = status === 'ready' && district && !compact ? t('common.aiChipReadyFrom', { district }) : t(WORDS[status]);
  return (
    <Link to={{ name: 'settings', section: 'ai' }} className={cx('chip', 'chip--button', 'ai-chip')} data-testid="ai-chip">
      <span className={cx('chip__dot', `chip__dot--${dotOf(status)}`)} aria-hidden="true" />
      {status === 'explain-only' && <Icon name="sparkle" size={16} />}
      <span>{text}</span>
    </Link>
  );
}
