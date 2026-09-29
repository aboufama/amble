/**
 * "What Amble sends" (§5.2, §2.15): every AI request, exactly as sent (the JSON body, never the headers,
 * so never the class code), with what it included in plain words and a short reply summary, kept on the
 * device (the last 50, clearable). The body is caught at the transport's own fetch hook, after the core
 * checked the address, so what is shown is byte for byte what went out.
 */
import type { Transport } from '../cores/ai';
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
      let body = '';
      const recording = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === 'string') body = init.body;
        return inner ? inner(input, init) : globalThis.fetch(input, init);
      }) as typeof fetch;
      let ended = false;
      return {
        transport: { ...transport, fetch: recording },
        end({ status, replySummary, bytesReceived = 0 }) {
          if (ended || !body) return;
          ended = true;
          const entry: AiLogEntry = { id: uid('g_'), at: now(), kind, host: transport.host, model, bytesSent: bytes(body), bytesReceived, included, body, status, replySummary: replySummary.slice(0, 200) };
          void store()?.ailog.add(entry).catch(() => undefined);
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
