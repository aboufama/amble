/**
 * "What Amble sends" (§5.2, §2.15): every AI request, exactly as sent (the JSON body, never the headers,
 * so never the class code), with what it included in plain words and a short reply summary, kept on the
 * device (the last 50, clearable). The body is caught at the transport's own fetch hook, after the core
 * checked the address, so what is shown is byte for byte what went out.
 *
 * One job can send more than one request (a retry after a busy answer, a retry without a feature the
 * endpoint refused, a repair round), and each is its own entry: the log never shows fewer requests than
 * went out, nor a later body in place of an earlier one (a retry without pictures must not hide the
 * outline the first request carried).
 */
import type { Transport } from '../cores/ai';
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { AiLogEntry } from '../model/types';
import type { Store } from '../store/api';

export interface LogHandle {
  /** The same transport, recording what it sends. */
  transport: Transport;
  end(o: { status: AiLogEntry['status']; replySummary: string; bytesReceived?: number }): void;
}

export interface RequestLog {
  begin(o: { kind: AiLogEntry['kind']; transport: Transport; model: string; included: string[] }): LogHandle;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

export function createRequestLog(store: () => Pick<Store, 'ailog'> | null, now: () => number = Date.now): RequestLog {
  return {
    begin({ kind, transport, model, included }) {
      const inner = transport.fetch;
      const sent: Array<{ body: string; at: number }> = [];
      const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === 'string') sent.push({ body: init.body, at: now() });
        return inner ? inner(input, init) : globalThis.fetch(input, init);
      }) as typeof fetch;
      let ended = false;
      return {
        transport: { ...transport, fetch: recording },
        end({ status, replySummary, bytesReceived = 0 }) {
          if (ended || !sent.length) return;
          ended = true;
          const log = store();
          if (!log) return;
          // One after another, so the entries keep the order the requests went out in.
          let chain: Promise<unknown> | null = null;
          sent.forEach(({ body, at }, i) => {
            const last = i === sent.length - 1;
            const entry: AiLogEntry = {
              id: uid('g_'),
              at,
              kind,
              host: transport.host,
              model,
              bytesSent: bytes(body),
              bytesReceived: last ? bytesReceived : 0,
              included,
              body,
              status: last ? status : 'failed',
              replySummary: (last ? replySummary : t('ai.replyRetried')).slice(0, 200),
            };
            chain = chain ? chain.catch(() => undefined).then(() => log.ailog.add(entry)) : log.ailog.add(entry);
          });
          void (chain as Promise<unknown> | null)?.catch(() => undefined);
        },
      };
    },
  };
}

/** Pretty JSON of a logged body for **Show exactly** (the body itself stays exactly as sent). */
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
