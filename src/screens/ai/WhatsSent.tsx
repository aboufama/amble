/**
 * **What Amble sends** (§2.15, §5.2; M5; the `#/sent` page shows it): the last 50 requests to the AI
 * helper with the time, the kind, the host, the sizes, what was included in plain words and the reply, and
 * **Show exactly** for the exact JSON body (never headers). **Clear the list** empties it. Printable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { t, type MessageKey } from '../../i18n';
import type { AiLogEntry } from '../../model/types';
import { prettyBody } from '../../pipeline/log';
import { announce } from '../../state/app';
import { formatBytes } from '../../store/quota';
import { confirmUser } from '../../ui/dialogs';
import { Button, Chip, Footprints, type ChipDot } from '../../ui/components';
import './ai.css';

const KIND: Record<AiLogEntry['kind'], MessageKey> = {
  plan: 'ai.kindPlan',
  build: 'ai.kindBuild',
  change: 'ai.kindChange',
  fix: 'ai.kindFix',
  resend: 'ai.kindResend',
  continue: 'ai.kindContinue',
  explain: 'ai.kindExplain',
  rig: 'ai.kindRig',
  moderation: 'ai.kindModeration',
  test: 'ai.kindTest',
};

const STATUS: Record<AiLogEntry['status'], { key: MessageKey; dot: ChipDot }> = {
  ok: { key: 'ai.sentStatusOk', dot: 'alive' },
  refused: { key: 'ai.sentStatusRefused', dot: 'warn' },
  failed: { key: 'ai.sentStatusFailed', dot: 'warn' },
  cancelled: { key: 'ai.sentStatusCancelled', dot: 'off' },
};

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Entry({ entry }: { entry: AiLogEntry }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[entry.status];
  return (
    <li className="ai-sent__item" data-testid="ai-sent-item" data-kind={entry.kind}>
      <div className="ai-sent__line">
        <span className="ai-sent__kind">{t(KIND[entry.kind])}</span>
        <span className="ai-sent__meta">{when(entry.at)}</span>
        <span className="ai-sent__meta">{t('ai.sentTo', { host: entry.host })}</span>
        <span className="ai-sent__meta">{t('ai.sentSizes', { sent: formatBytes(entry.bytesSent), received: formatBytes(entry.bytesReceived) })}</span>
        <span className="ai-sent__status">
          <Chip dot={status.dot}>{t(status.key)}</Chip>
        </span>
      </div>
      <p className="ai-sent__what">
        <strong>{t('ai.sentIncluded')}</strong> {entry.included.join(', ')}
      </p>
      {entry.replySummary && (
        <p className="ai-sent__what">
          <strong>{t('ai.sentReply')}</strong> {entry.replySummary}
        </p>
      )}
      <div>
        <Button size={38} variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('ai.sentHide') : t('ai.sentShow')}
        </Button>
      </div>
      {open && (
        <pre className="ai-sent__body" tabIndex={0} data-testid="ai-sent-body">
          {prettyBody(entry.body)}
        </pre>
      )}
    </li>
  );
}

export function WhatsSent() {
  const { store } = useServices();
  const [entries, setEntries] = useState<AiLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    store.ailog
      .list()
      .then((list) => {
        setEntries(list.slice(0, 50));
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [store]);

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const clear = async () => {
    const ok = await confirmUser({ title: t('ai.sentClear'), body: t('ai.sentClearConfirm'), ok: t('ai.sentClear'), danger: true });
    if (!ok) return;
    await store.ailog.clear().catch(() => undefined);
    load();
    announce(t('ai.sentCleared'));
  };

  return (
    <section className="ai-sent" aria-labelledby="ai-sent-title" data-testid="ai-sent">
      <div className="ai-sent__head">
        <h1 id="ai-sent-title" className="ai-sent__title">
          {t('ai.sentTitle')}
        </h1>
        {entries && entries.length > 0 && (
          <Button variant="danger" size={38} onClick={() => void clear()}>
            {t('ai.sentClear')}
          </Button>
        )}
      </div>
      <p className="ai-sent__intro">{t('ai.sentIntro')}</p>
      <p className="ai-sent__intro">{t('ai.sentNever')}</p>
      {failed ? (
        <p className="ai-sent__intro" role="alert">
          {t('ai.sentLoadFailed')}
        </p>
      ) : entries === null ? (
        <Footprints />
      ) : entries.length === 0 ? (
        <p className="ai-sent__intro" data-testid="ai-sent-empty">
          {t('ai.sentEmpty')}
        </p>
      ) : (
        <ol className="ai-sent__list">
          {entries.map((e) => (
            <Entry key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </section>
  );
}
