/**
 * The live test of an AI address (§2.14, §2.15): one tiny request through the AI core's transport, the
 * exact words teachers and IT read when it fails, and the request logged exactly as sent (What Amble
 * sends), without the class code, which travels in a header.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/i18n';
import { formatSeconds, hostOf, testEndpoint, type EndpointSpec } from '../../src/school/testConnection';
import { MemoryStore } from '../../src/store/memory';

const SPEC: EndpointSpec = { baseUrl: 'https://ai.test/v1', model: 'amble-default', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' } };

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const OK = { id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] };

describe('testing an AI address', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says it works, and logs the exact body without the class code', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return reply(200, OK);
    });
    const store = new MemoryStore();
    const result = await testEndpoint(SPEC, { store, timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ai.test/v1/chat/completions');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('X-Amble-Class')).toBe('MAPLE-7Q2K');

    const [entry] = await store.ailog.list();
    expect(entry).toMatchObject({ kind: 'test', host: 'ai.test', model: 'amble-default', status: 'ok' });
    expect(entry.body).toBe(calls[0].init.body);
    expect(entry.body).not.toContain('MAPLE-7Q2K');
    expect(entry.bytesSent).toBe(new TextEncoder().encode(String(calls[0].init.body)).length);
  });

  it('names a wrong class code, with the status', async () => {
    vi.stubGlobal('fetch', async () => reply(401, { error: { message: 'bad code' } }));
    const store = new MemoryStore();
    const result = await testEndpoint(SPEC, { store, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, status: 401, message: t('school.staff_testAuthCode', { status: 401 }) });
    expect((await store.ailog.list())[0]).toMatchObject({ status: 'failed' });
  });

  it('says when nothing answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await testEndpoint(SPEC, { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
  });

  it('refuses an address that isn’t https', async () => {
    const result = await testEndpoint({ ...SPEC, baseUrl: 'http://ai.example/v1' }, { timeoutMs: 5000 });
    expect(result).toMatchObject({ ok: false });
  });

  it('formats hosts and times', () => {
    expect(hostOf('https://amble-ai.sau99.org/v1')).toBe('amble-ai.sau99.org');
    expect(hostOf('not a url')).toBe('not a url');
    expect(formatSeconds(912)).toBe('0.9 s');
    expect(formatSeconds(3)).toBe('0.1 s');
  });
});
