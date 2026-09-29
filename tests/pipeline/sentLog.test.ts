/**
 * "What Amble sends" must list every request that went over the wire (§1.5 law 5, §2.15): one AI job can
 * send several (a 429 retry, a 400 fallback that drops a feature, a JSON repair round), and each one is
 * logged exactly as sent. The case that matters most: Magic bones sends the drawing's outline, and when
 * the endpoint refuses pictures, the retry goes out without it; the log must still show the outline.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeLayers, transportFor, type AiConfig, type Transport } from '../../src/cores/ai';
import { createHistory } from '../../src/history/api';
import type { AiMode, ClassLinkV1, Level } from '../../src/model/types';
import type { AppServicesLike } from '../../src/pipeline/env';
import { createRequestLog } from '../../src/pipeline/log';
import { createAiService, type AiEnv, type AiEnvConfig } from '../../src/pipeline/service';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { fakeEndpoint, httpError, plain, sse, type Reply } from '../ai/fakeEndpoint';
import { fakeRobot, fixture, world } from './helpers';

const BASE = 'https://ai.example.org/v1';

function visionConfig(): AiConfig {
  return mergeLayers([
    {
      source: 'class-link',
      baseUrl: BASE,
      auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' },
      model: 'main-model',
      fastModel: 'fast-model',
      visionModel: 'vision-model',
      visionAllowed: true,
      moderation: 'local-only',
      caps: {},
      district: { name: 'SAU 99', privacyUrl: '', contact: '' },
    },
  ]);
}

function service(replies: Reply[]) {
  const endpoint = fakeEndpoint(replies);
  const store = new MemoryStore();
  const cfg: AiEnvConfig = { ai: visionConfig(), aiMode: 'on' as AiMode, level: 'middle' as Level, levelMax: 'high' as Level, classLink: null as ClassLinkV1 | null, school: true };
  const services: AppServicesLike = { store, player: { robot: () => Promise.reject(new Error('unused')) }, starters: createStarterCatalog(), history: createHistory() };
  const env: AiEnv = {
    config: () => cfg,
    onConfig: () => () => undefined,
    services: () => services,
    transport: (c) => transportFor(c, { fetch: endpoint.fetch, isOnline: () => true }),
    robot: () => fakeRobot().robot,
    random: () => 0,
    online: () => true,
    onOnline: () => () => undefined,
    publish: () => undefined,
  };
  return { ai: createAiService(env), sent: endpoint.sent, store };
}

const job = () => ({ signal: new AbortController().signal, onProgress: () => undefined });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('What Amble sends lists every request', () => {
  it('logs each body the transport sends in one job, in order, the last with the outcome', async () => {
    const store = new MemoryStore();
    let clock = 1000;
    const log = createRequestLog(() => store, () => clock++);
    const transport = { host: 'ai.example.org', fetch: async () => new Response('{}') } as unknown as Transport;
    const handle = log.begin({ kind: 'plan', transport, model: 'fast-model', included: ['your idea'] });
    await handle.transport.fetch!('https://ai.example.org/v1/chat/completions', { method: 'POST', body: '{"first":true}' });
    await handle.transport.fetch!('https://ai.example.org/v1/chat/completions', { method: 'POST', body: '{"second":true}' });
    handle.end({ status: 'ok', replySummary: 'A plan' });
    await vi.waitFor(async () => expect(await store.ailog.list()).toHaveLength(2));
    // The store lists the newest first.
    const entries = (await store.ailog.list()).reverse();
    expect(entries.map((e) => e.body)).toEqual(['{"first":true}', '{"second":true}']);
    expect(entries[1]).toMatchObject({ status: 'ok', replySummary: 'A plan' });
    expect(entries[0]).toMatchObject({ status: 'failed', replySummary: "This one didn't go through, so Amble sent it again" });
    expect(entries[0].at).toBeLessThan(entries[1].at);
  });

  it('shows a retried change twice, exactly as each went out', async () => {
    const h = service([httpError(429, 'Rate limit reached', { headers: { 'retry-after-ms': '20' } }), sse([fixture('change-stomp.patch')])]);
    const out = await h.ai.change(world(), 'let me stomp the grumbles', job());
    expect(out.kind).toBe('accepted');
    expect(h.sent).toHaveLength(2);
    const entries = (await h.store.ailog.list()).reverse();
    expect(entries.map((e) => e.body)).toEqual(h.sent.map((r) => String(r.init.body)));
  });

  it('still shows the outline when the endpoint refuses pictures and the retry goes without it', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 64, close: () => undefined }));
    const rig = { kind: 'biped', facing: 'viewer', joints: [{ name: 'neck', x: 500, y: 300 }], extras: [] };
    const h = service([httpError(400, 'Invalid content: image_url is only supported by certain models.', { param: 'messages' }), plain(JSON.stringify(rig))]);
    const outline = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
    await h.ai.rigHints(outline, 'biped', { signal: new AbortController().signal });
    expect(h.sent).toHaveLength(2);
    expect(String(h.sent[0].init.body)).toContain('image_url');
    const entries = (await h.store.ailog.list()).reverse();
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.kind === 'rig' && e.body.includes('image_url'))).toBe(true);
    expect(entries.map((e) => e.body)).toEqual(h.sent.map((r) => String(r.init.body)));
  });
});
