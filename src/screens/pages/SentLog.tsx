/**
 * `#/sent` What Amble sends (§2.15, §5.2): the last 50 AI requests on this Chromebook, newest first, each
 * with its time, kind, host, sizes and what it included in plain words, and **Show exactly** for the full
 * JSON body as sent (headers such as the class code are never kept). **Clear** empties the list.
 */
import { useEffect, useState } from 'react';
import { useServices } from '../../app/services';
import { t, type MessageKey } from '../../i18n';
import { tn } from '../../school/count';
import type { AiLogEntry } from '../../model/types';
import { announce } from '../../state/app';
import { Button, Chip, Footprints } from '../../ui/components';
import { confirmUser } from '../../ui/dialogs';
import { Icon } from '../../ui/icons';
import { formatBytes } from '../settings/StorageSection';
import { PageShell } from './PageShell';

const KIND_WORDS: Record<AiLogEntry['kind'], MessageKey> = {
  plan: 'school.sentKindPlan',
  build: 'school.sentKindBuild',
  change: 'school.sentKindChange',
  fix: 'school.sentKindFix',
  resend: 'school.sentKindResend',
  continue: 'school.sentKindContinue',
  explain: 'school.sentKindExplain',
  rig: 'school.sentKindRig',
  moderation: 'school.sentKindModeration',
  test: 'school.sentKindTest',
};

const STATUS_WORDS: Record<AiLogEntry['status'], MessageKey> = {
  ok: 'school.sentOk',
  refused: 'school.sentRefused',
  failed: 'school.sentFailed',
  cancelled: 'school.sentCancelled',
};

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function Entry({ e }: { e: AiLogEntry }) {
  const [open, setOpen] = useState(false);
  const when = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(e.at);
  return (
    <li className="sent" data-testid="sent-entry">
      <div className="sent__head">
        <p className="sent__kind">{t(KIND_WORDS[e.kind])}</p>
        <p className="page__meta">{when}</p>
        <Chip dot={e.status === 'ok' ? 'alive' : e.status === 'cancelled' ? 'off' : 'warn'}>{t(STATUS_WORDS[e.status])}</Chip>
      </div>
      <p className="sent__to">{t('school.sentTo', { host: e.host, model: e.model })}</p>
      <p className="page__meta">{t('school.sentSizes', { sent: formatBytes(e.bytesSent), received: formatBytes(e.bytesReceived) })}</p>
      {e.included.length > 0 && (
        <div className="sent__included">
          <p className="sent__label">{t('school.sentIncluded')}</p>
          <ul>
            {e.included.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {e.replySummary && <p className="sent__reply">{t('school.sentReply', { reply: e.replySummary })}</p>}
      <button type="button" className="btn btn--quiet btn--h38" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'eyeOff' : 'eye'} size={18} />
        <span className="btn__label">{open ? t('school.sentHide') : t('school.sentShow')}</span>
      </button>
      {open && (
        <pre className="page__code sent__body" tabIndex={0}>
          {pretty(e.body)}
        </pre>
      )}
    </li>
  );
}

export function SentLog() {
  const { store } = useServices();
  const [entries, setEntries] = useState<AiLogEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void store.ailog
      .list()
      .then((list) => live && setEntries([...list].sort((a, b) => b.at - a.at)))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [store]);

  const clear = async () => {
    const ok = await confirmUser({ title: t('school.sentClearTitle'), body: t('school.sentClearBody'), ok: t('school.sentClear') });
    if (!ok) return;
    await store.ailog.clear();
    setEntries([]);
    announce(t('school.sentCleared'));
  };

  return (
    <PageShell page="sent" title={t('common.routeSent')} lede={<p>{t('school.page_sentLede')}</p>}>
      {entries === null ? (
        <Footprints label={t('school.sentLoading')} />
      ) : entries.length === 0 ? (
        <div className="page__empty">
          <Icon name="info" size={28} />
          <p>{t('school.sentEmpty')}</p>
        </div>
      ) : (
        <>
          <div className="sent__tools">
            <p className="page__meta">{tn('school.sentCount', entries.length)}</p>
            <Button variant="ghost" size={38} icon="close" onClick={() => void clear()}>
              {t('school.sentClear')}
            </Button>
          </div>
          <ol className="sent__list">
            {entries.map((e) => (
              <Entry key={e.id} e={e} />
            ))}
          </ol>
        </>
      )}
    </PageShell>
  );
}
