/**
 * The live test of an AI address (Teacher desk class code, Settings' Test connection; §2.14, §2.15): one
 * tiny request ("Reply with the word OK.", at most 16 tokens) through the AI core's transport, so the same
 * door, origin check, headers and error handling as every AI request. The exact body goes to the request log
 * (What Amble sends), like every other request.
 */
import { isAiError, mergeLayers, pingModel, transportFor, type AiAuth, type Transport } from '../cores/ai';
import { uid } from '../model/ids';
import type { AiLogEntry } from '../model/types';
import type { Store } from '../store/api';
import { t } from '../i18n';

export interface EndpointSpec {
  baseUrl: string;
  model: string;
  auth: AiAuth;
}

export type TestResult = { ok: true; ms: number } | { ok: false; message: string; status: number | null };

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** "0.9 s" */
export function formatSeconds(ms: number): string {
  return `${(Math.max(ms, 50) / 1000).toFixed(1)} s`;
}

/** The exact words for a failed test (teachers and IT read these; they name the status). */
export function testFailure(err: unknown, spec: EndpointSpec): { message: string; status: number | null } {
  const host = hostOf(spec.baseUrl);
  if (!isAiError(err)) return { message: t('school.staff_testUnknown', { host }), status: null };
  const status = err.status ?? null;
  const answered = (key: 'staff_testAuthCode' | 'staff_testAuthKey' | 'staff_testAuthNone' | 'staff_testSetup' | 'staff_testQuota' | 'staff_testServer') =>
    t(`school.${key}`, { status: status ?? '?' });
  switch (err.kind) {
    case 'auth':
      return { message: answered(spec.auth.type === 'class-code' ? 'staff_testAuthCode' : spec.auth.type === 'bearer' ? 'staff_testAuthKey' : 'staff_testAuthNone'), status };
    case 'setup':
      return { message: answered('staff_testSetup'), status };
    case 'quota':
      return { message: answered('staff_testQuota'), status };
    case 'server':
      return { message: answered('staff_testServer'), status };
    case 'rate-limited':
      return { message: t('school.staff_testBusy'), status };
    case 'blocked-by-filter':
      return { message: t('school.staff_testBlocked', { host }), status };
    case 'offline':
      return { message: t('school.staff_testOffline'), status };
    case 'timeout':
      return { message: t('school.staff_testTimeout', { host }), status };
    case 'cancelled':
      return { message: t('school.staff_testCancelled'), status };
    default:
      return { message: status ? t('school.staff_testOther', { status, host }) : err.message, status };
  }
}

/** A transport to one address, whose requests' exact bodies are handed to `onBody` (for the request log). */
export function endpointTransport(spec: EndpointSpec, onBody: (body: string, received: () => number) => void): Transport | null {
  const config = mergeLayers([
    { source: spec.auth.type === 'bearer' ? 'manual' : 'class-link', baseUrl: spec.baseUrl, auth: spec.auth, model: spec.model, fastModel: spec.model },
  ]);
  const base = transportFor(config);
  if (!base) return null;
  // Observes the body and the reply size only: the core's own door has already checked the origin, and the
  // request goes out exactly as the core built it.
  const send = base.fetch ?? globalThis.fetch.bind(globalThis);
  const observed: typeof globalThis.fetch = async (input, init) => {
    let received = 0;
    if (typeof init?.body === 'string') onBody(init.body, () => received);
    const res = await send(input, init);
    void res
      .clone()
      .text()
      .then((text) => (received = text.length))
      .catch(() => undefined);
    return res;
  };
  return { ...base, fetch: observed };
}

export interface TestOptions {
  signal?: AbortSignal;
  /** Where the request is logged (What Amble sends). */
  store?: Pick<Store, 'ailog'> | null;
  timeoutMs?: number;
}

/** Sends the one-line test and says how it went. */
export async function testEndpoint(spec: EndpointSpec, o: TestOptions = {}): Promise<TestResult> {
  let body: string | null = null;
  let received: () => number = () => 0;
  const transport = endpointTransport(spec, (b, r) => {
    body = b;
    received = r;
  });
  if (!transport) return { ok: false, message: t('school.staff_testNoAddress'), status: null };
  const at = Date.now();
  let result: TestResult;
  try {
    const ms = await pingModel(transport, spec.model, { signal: o.signal, timeoutMs: o.timeoutMs ?? 30_000 });
    result = { ok: true, ms };
  } catch (err) {
    result = { ok: false, ...testFailure(err, spec) };
  }
  if (body !== null && o.store) {
    const sent: string = body;
    const entry: AiLogEntry = {
      id: uid('l_'),
      at,
      kind: 'test',
      host: hostOf(spec.baseUrl),
      model: spec.model,
      bytesSent: new TextEncoder().encode(sent).length,
      bytesReceived: received(),
      included: [t('school.logTestIncluded')],
      body: sent,
      status: result.ok ? 'ok' : 'failed',
      replySummary: result.ok ? t('school.logTestOk', { time: formatSeconds(result.ms) }) : result.message,
    };
    await o.store.ailog.add(entry).catch(() => undefined);
  }
  return result;
}
