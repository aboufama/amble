/** The AI service end to end over the real transport, with a scripted endpoint and a fake robot. */
import { describe, expect, it } from 'vitest';
import { mergeLayers, transportFor, type AiConfig } from '../../src/cores/ai';
import { createHistoryStub } from '../../src/history/api';
import type { AiMode, AiStatus, Level, ClassLinkV1 } from '../../src/model/types';
import type { AppServicesLike } from '../../src/pipeline/env';
import { SYSTEM_PROMPT } from '../../src/pipeline/prompts/system';
import { createAiService, type AiEnv, type AiEnvConfig } from '../../src/pipeline/service';
import { createStarterStub } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { fakeEndpoint, httpError, plain, sse, type Reply } from '../ai/fakeEndpoint';
import { fakeRobot, fixture, PLAN_SNAIL, robotFail, world } from './helpers';

const BASE = 'https://ai.example.org/v1';

function aiConfig(code = 'MAPLE-7Q2K'): AiConfig {
  return mergeLayers([{ source: 'class-link', baseUrl: BASE, auth: { type: 'class-code', header: 'X-Amble-Class', code }, model: 'main-model', fastModel: 'fast-model', visionModel: 'vision-model', moderation: 'local-only', caps: {}, district: { name: 'SAU 99', privacyUrl: '', contact: '' } }]);
}

interface Harness {
  service: ReturnType<typeof createAiService>;
  sent: ReturnType<typeof fakeEndpoint>['sent'];
  store: MemoryStore;
  statuses: AiStatus[];
  setConfig(c: Partial<AiEnvConfig>): void;
  setOnline(v: boolean): void;
}

function harness(replies: Reply[], o: { config?: Partial<AiEnvConfig>; robot?: ReturnType<typeof fakeRobot> } = {}): Harness {
  const endpoint = fakeEndpoint(replies);
  const store = new MemoryStore();
  let online = true;
  let cfg: AiEnvConfig = { ai: aiConfig(), aiMode: 'on' as AiMode, level: 'middle' as Level, levelMax: 'high' as Level, classLink: null as ClassLinkV1 | null, school: true, ...o.config };
  const configListeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  const statuses: AiStatus[] = [];
  const robot = o.robot ?? fakeRobot();
  const services: AppServicesLike = { store, player: { robot: () => Promise.reject(new Error('unused')) }, starters: createStarterStub(), history: createHistoryStub() };
  const env: AiEnv = {
    config: () => cfg,
    onConfig: (fn) => (configListeners.add(fn), () => configListeners.delete(fn)),
    services: () => services,
    transport: (c) => transportFor(c, { fetch: endpoint.fetch, isOnline: () => online }),
    robot: () => robot.robot,
    random: () => 0,
    online: () => online,
    onOnline: (fn) => (onlineListeners.add(fn), () => onlineListeners.delete(fn)),
    publish: (s) => statuses.push(s),
  };
  const service = createAiService(env);
  return {
    service,
    sent: endpoint.sent,
    store,
    statuses,
    setConfig(c) {
      cfg = { ...cfg, ...c };
      for (const fn of configListeners) fn();
    },
    setOnline(v) {
      online = v;
      for (const fn of onlineListeners) fn();
    },
  };
}

const job = () => ({ signal: new AbortController().signal, onProgress: () => undefined });
const htmlPage = () => new Response('<html><body>Blocked by the school filter</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });

describe('the helper status', () => {
  it('is off with no config, ready with one, explain-only for an explain class', () => {
    const h = harness([], { config: { ai: null } });
    expect(h.service.status()).toBe('off');
    h.setConfig({ ai: aiConfig() });
    expect(h.service.status()).toBe('ready');
    h.setConfig({ classLink: { v: 1, cls: 'Room 12', district: null, ai: null, mode: 'explain', level: 'middle', exp: null, asg: null }, aiMode: 'explain' });
    expect(h.service.status()).toBe('explain-only');
    expect(h.statuses).toEqual(['off', 'ready', 'explain-only']);
  });

  it('shows blocked (with the host) after a filter page, and clears on Try again', async () => {
    const h = harness([htmlPage()]);
    const out = await h.service.change(world(), 'make the boss angrier', job());
    expect(out).toMatchObject({ kind: 'unavailable', status: 'blocked' });
    expect(out.kind === 'unavailable' && out.message).toBe("Amble couldn't reach ai.example.org. Your school's web filter may be blocking it. Everything else still works.");
    expect(h.service.status()).toBe('blocked');
    h.service.retry();
    expect(h.service.status()).toBe('ready');
  });

  it('maps a 401 on a class code to the expired link, and 403 quota to the quota copy', async () => {
    const h = harness([httpError(401, 'bad class code'), httpError(403, 'Your class used its daily quota', { code: 'quota_exceeded' })]);
    expect(await h.service.change(world(), 'add lava', job())).toMatchObject({ kind: 'unavailable', status: 'expired' });
    h.service.retry();
    expect(await h.service.change(world(), 'add lava', job())).toMatchObject({ kind: 'unavailable', status: 'quota' });
  });

  it('is offline while the device is offline, and nothing is sent', async () => {
    const h = harness([]);
    h.setOnline(false);
    expect(h.service.status()).toBe('offline');
    expect(await h.service.change(world(), 'add lava', job())).toMatchObject({ kind: 'unavailable', status: 'offline' });
    expect(h.sent).toHaveLength(0);
  });
});

describe('a change, over the wire', () => {
  it('is accepted, robot-tested, and logged exactly as sent (no headers, no class code)', async () => {
    const robot = fakeRobot();
    const h = harness([sse([fixture('change-stomp.patch')])], { robot });
    const out = await h.service.change(world(), 'let me stomp the grumbles', job());
    expect(out.kind).toBe('accepted');
    if (out.kind !== 'accepted') return;
    expect(out.tested).toBe(true);
    expect(out.summary).toBe('Now your hero can stomp on Grumbles to squash them.');
    expect(out.files.find((f) => f.path === 'game.js')?.source).toContain('stomp: true');
    expect(out.files.find((f) => f.path === 'game.js')?.authors.some(([a]) => a === 'ai')).toBe(true);
    expect(out.next).toEqual(['Make Grumbles faster', 'Give the Moon King a stomp too']);

    const req = h.sent[0];
    expect(req.headers['x-amble-class']).toBe('MAPLE-7Q2K');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.body.store).toBe(false);
    expect(req.body.model).toBe('main-model');
    expect(req.body.max_completion_tokens).toBe(8000);
    expect((req.body.messages as Array<{ content: string }>)[0].content).toBe(SYSTEM_PROMPT);

    const log = await h.store.ailog.list();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'change', host: 'ai.example.org', model: 'main-model', status: 'ok' });
    expect(log[0].body).toBe(String(req.init.body));
    expect(log[0].body).not.toContain('MAPLE-7Q2K');
    expect(log[0].body).not.toContain('"AB"');
    expect(log[0].included).toEqual(expect.arrayContaining(['your words', 'the list of drawings (no pictures)']));
    expect(log[0].replySummary).toBe('Changed game.js');
  });

  it('sends the same system prompt at every level and for every class', async () => {
    const a = harness([sse([fixture('change-stomp.patch')])], { config: { level: 'elementary' } });
    const b = harness([sse([fixture('change-stomp.patch')])], { config: { level: 'high', ai: aiConfig('OTHER-CLASS') } });
    await a.service.change(world(), 'stomp', job());
    await b.service.change(world({ level: 'high' }), 'stomp', job());
    const system = (h: Harness) => (h.sent[0].body.messages as Array<{ content: string }>)[0].content;
    expect(system(a)).toBe(system(b));
    expect(String((a.sent[0].body.messages as Array<{ content: string }>)[1].content)).toContain('Content level: elementary');
    expect(String((b.sent[0].body.messages as Array<{ content: string }>)[1].content)).toContain('Content level: high');
  });

  it('answers a stream request with a plain JSON body just the same', async () => {
    const h = harness([plain(fixture('change-stomp.patch'))]);
    expect((await h.service.change(world(), 'stomp', job())).kind).toBe('accepted');
  });

  it('keeps one job per world', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const h = harness([async () => (await gate, sse([fixture('change-stomp.patch')]))]);
    const w = world();
    const first = h.service.change(w, 'stomp', job());
    await new Promise((r) => setTimeout(r, 5));
    expect(h.service.busy(w.id)).toBe(true);
    expect(await h.service.change(w, 'more', job())).toMatchObject({ kind: 'failed', message: 'Amble is still working on your last change.' });
    release();
    expect((await first).kind).toBe('accepted');
    expect(h.service.busy(w.id)).toBe(false);
  });

  it('turns a content filter into the refusal card with alternatives', async () => {
    const h = harness([httpError(400, 'The response was filtered due to the prompt triggering content management policy.', { code: 'content_filter' })]);
    const out = await h.service.change(world(), 'something odd', job());
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.alternatives).toEqual(['Make the enemies pop into confetti', 'Turn it into a water-balloon fight']);
  });
});

describe('safety before anything is sent', () => {
  it('crisis words show the crisis card and send nothing', async () => {
    const h = harness([]);
    expect(await h.service.change(world(), 'i want to kill myself', job())).toEqual({ kind: 'crisis' });
    expect(await h.service.plan('nobody would care if i died', { level: 'middle', hero: null, ...job() })).toEqual({ kind: 'crisis' });
    expect(h.sent).toHaveLength(0);
  });

  it('refuses real-person targeting and school attacks locally, with kind alternatives', async () => {
    const h = harness([]);
    const out = await h.service.change(world(), 'make a game where we punch my teacher Mr Smith', job());
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.note).toBe("Games about real people from your school or family aren't allowed, even as a joke.");
      expect(out.alternatives[0]).toBe('Make up a character with a funny name');
    }
    expect((await h.service.change(world(), 'shoot up the school', job())).kind).toBe('refused');
    expect(h.sent).toHaveLength(0);
  });

  it('blocks personal info at elementary and lets it through (after the warning) above', async () => {
    const low = harness([], { config: { level: 'elementary' } });
    const words = 'make the hero say my phone number is 603-555-0199';
    expect(await low.service.change(world({ level: 'elementary' }), words, job())).toMatchObject({ kind: 'refused' });
    expect(low.sent).toHaveLength(0);
    const mid = harness([sse([fixture('change-stomp.patch')])]);
    expect((await mid.service.change(world(), words, job())).kind).toBe('accepted');
    expect(mid.sent).toHaveLength(1);
  });
});

describe('plans', () => {
  it('returns a checked plan from the fast model', async () => {
    const h = harness([plain(fixture('plan-snail.json'))]);
    const out = await h.service.plan('a snail who saves her friends from a salt king', { level: 'middle', hero: { name: 'Shelly', kind: 'character', rig: 'blob' }, ...job() });
    expect(out.kind).toBe('plan');
    if (out.kind !== 'plan') return;
    expect(out.plan.title).toBe("Shelly's Big Rescue");
    expect(out.plan.cast[0]).toMatchObject({ key: 'hero', role: 'hero', name: 'Shelly', rig: 'blob' });
    const body = h.sent[0].body;
    expect(body.model).toBe('fast-model');
    expect((body.response_format as { json_schema: { name: string; strict: boolean } }).json_schema).toMatchObject({ name: 'amble_plan', strict: true });
    const user = String((body.messages as Array<{ content: string }>)[1].content);
    expect(user).toContain('The student\'s hero (already drawn): "Shelly", a blob.');
    expect(user).toContain('- moon-king: boss fight, platformer + shooter. Keys: hero, moonKing, grumble, star, sky.');
    expect((await h.store.ailog.list())[0]).toMatchObject({ kind: 'plan', included: ['your idea', "your hero's name and kind"] });
  });

  it('falls back to the closest starter when the plan call fails', async () => {
    const h = harness([httpError(401, 'no')]);
    const out = await h.service.plan('a maze with ghosts and keys', { level: 'middle', hero: null, ...job() });
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') {
      expect(out.starter).toBe('lantern-maze');
      expect(out.message).toContain("The AI helper can't answer right now. Let's start from a world close to your idea:");
    }
  });

  it('passes a refused plan through with alternatives', async () => {
    const refused = { ...PLAN_SNAIL, status: 'refused', safetyNote: 'Amble can only make kind games. How about a snail race?' };
    const h = harness([plain(JSON.stringify(refused))]);
    const out = await h.service.plan('something unkind', { level: 'middle', hero: null, ...job() });
    expect(out).toMatchObject({ kind: 'refused', note: 'Amble can only make kind games. How about a snail race?' });
  });
});

describe('builds and the ladder', () => {
  const broken = '@@amble-patch 1\n@@summary Broken.\n@@safety ok\n@@file game.js create\nclass Game extends Amble.Scene {\n  create() { this.oops( }\n}\n@@end\n';

  it('builds from the plan on the starter and declares the plan keys', async () => {
    const h = harness([sse([fixture('build-moon-king.patch')])]);
    const w = world({ origin: { kind: 'plan', starter: 'moon-king', planTitle: PLAN_SNAIL.title }, plan: PLAN_SNAIL });
    const out = await h.service.build(w, PLAN_SNAIL, job());
    expect(out.kind).toBe('accepted');
    expect(h.sent[0].body.max_completion_tokens).toBe(16000);
    if (out.kind === 'accepted') expect(out.manifest.art.map((a) => a.key)).toEqual(expect.arrayContaining(['hero', 'saltKing', 'crumb', 'leaf']));
  });

  it('ends a failed build on the plan starter with the plan written in', async () => {
    const h = harness([sse([broken]), sse([broken]), sse([broken])]);
    const w = world({ origin: { kind: 'plan', starter: 'moon-king', planTitle: PLAN_SNAIL.title }, plan: PLAN_SNAIL });
    const out = await h.service.build(w, PLAN_SNAIL, job());
    expect(out.kind).toBe('fallback');
    if (out.kind !== 'fallback') return;
    expect(h.sent).toHaveLength(3);
    const game = out.files.find((f) => f.path === 'game.js')?.source ?? '';
    expect(game).toContain("title: 'Shelly\\'s Big Rescue'");
    expect(game).toMatch(/moonKing: \{[^\n]*name: 'The Salt King'/);
    expect(game).toMatch(/moonKing: \{[^\n]*ask: 'Draw the Salt King, a grumpy salt shaker'/);
    expect(out.message).toMatch(/^Amble couldn't build all of it, so it started you from .+ with your ideas\. Your other characters are waiting on the cast line\./);
  });

  it('robot-tests a change and repairs a runtime error with a fix request', async () => {
    const robot = fakeRobot([robotFail('boss.js', 3, "Cannot read properties of undefined (reading 'amount')")]);
    const h = harness([sse([fixture('change-throws.patch')]), sse([fixture('fix-ok.patch')])], { robot });
    const out = await h.service.change(world(), 'make the moon king stomp', job());
    expect(out).toMatchObject({ kind: 'accepted', repairs: 1, tested: true });
    const fixUser = String((h.sent[1].body.messages as Array<{ content: string }>)[1].content);
    expect(fixUser).toMatch(/^Task: fix\n/);
    expect(fixUser).toContain('boss.js:3');
    expect(h.sent[1].body.max_completion_tokens).toBe(6000);
  });
});

describe('explain', () => {
  it('explains lines in strict JSON, even in an explain-only class', async () => {
    const h = harness([plain(JSON.stringify({ answer: 'These lines make the Moon King float in a figure eight.', lines: [{ from: 70, to: 72, note: 'The sine makes him bob.' }], safetyNote: '' }))], {
      config: { classLink: { v: 1, cls: 'Room 12', district: null, ai: null, mode: 'explain', level: 'middle', exp: null, asg: null }, aiMode: 'explain' },
    });
    expect(h.service.status()).toBe('explain-only');
    expect((await h.service.change(world(), 'add lava', job())).kind).toBe('unavailable');
    const out = await h.service.explain(world(), { path: 'game.js', from: 68, to: 75, question: 'What does this do?' }, { signal: new AbortController().signal });
    expect(out.kind).toBe('explained');
    const body = h.sent[0].body;
    expect((body.response_format as { json_schema: { name: string } }).json_schema.name).toBe('amble_explain');
    expect(String((body.messages as Array<{ content: string }>)[1].content)).toContain('68 | ');
  });
});
