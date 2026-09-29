import { describe, expect, it } from 'vitest';
import {
  classLinkUrl,
  encodeClassLink,
  isClassLinkExpired,
  layerFromClassLink,
  loadClassLink,
  readClassLink,
  saveClassLink,
  clearClassLink,
  stripClassLinkFromUrl,
  validateClassLink,
  type ClassLink,
} from '../../src/ai/config/classLink';
import { layerFromEnv } from '../../src/ai/config/env';
import { layerFromManaged, readManagedConfig } from '../../src/ai/config/managed';
import { mergeLayers } from '../../src/ai/config/merge';
import { aiAvailable, describeAiSource, modelFor, resolveAiConfig, transportFor } from '../../src/ai/config/resolve';
import { deviceId, safetyIdentifier } from '../../src/ai/config/safetyId';
import { clearAiSettings, layerFromSettings, loadAiSettings, OPENAI_BASE_URL, saveAiSettings } from '../../src/ai/config/settings';
import { DEFAULT_AI_SETTINGS, type AiSettings, type ConfigLayer } from '../../src/ai/config/types';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const KEY = ['sk', 'test', 'Ab3dEf6hIj9kLm2nOp5qRs8t'].join('-');
const settings = (over: Partial<AiSettings> = {}): AiSettings => ({ ...DEFAULT_AI_SETTINGS, ...over });
const link = (over: Partial<ClassLink> = {}): ClassLink => ({ v: 1, baseUrl: 'https://amble-ai.sau99.org/v1', model: 'amble-default', code: 'MAPLE-7Q2K', name: 'Room 12', ...over });
const build = (over: Partial<ConfigLayer> = {}): ConfigLayer => ({ source: 'build', ...over });
const managed = (over: Partial<ConfigLayer> = {}): ConfigLayer => ({ source: 'managed', schoolMode: true, ...over });

describe('class links', () => {
  it('round-trips through the URL fragment, names in any language included', () => {
    const l = link({ fastModel: 'amble-fast', visionAllowed: true, district: 'SAU 99 · École', policy: { ageBand: 'high', lock: ['content'], expires: '2027-06-30', safetyIdentifier: true } });
    const url = classLinkUrl('https://amble.sau99.org/#/home', l);
    expect(url).toMatch(/^https:\/\/amble\.sau99\.org\/#class=[A-Za-z0-9_-]+$/);
    const read = readClassLink(new URL(url).hash);
    expect(read).toEqual({ ok: true, link: l });
    expect(readClassLink('#/home?class=' + encodeClassLink(l) + '&tab=2')).toEqual({ ok: true, link: l });
    expect(readClassLink('#/home')).toBeNull();
  });

  it('never carries a key: a link with one is refused whole', () => {
    const bad: unknown[] = [
      { ...link(), apiKey: 'whatever' },
      { ...link(), model: KEY },
      { ...link(), policy: { token: 'x' } },
      { ...link(), code: `Bearer ${KEY}` },
      { ...link(), baseUrl: 'https://proxy.example.org/v1?key=0f3a9c1e7b2d4f6a8c0e1b3d5f7a9c2e' },
    ];
    for (const b of bad) expect(validateClassLink(b)).toMatchObject({ ok: false, error: expect.stringMatching(/key/i) });
    expect(() => encodeClassLink({ ...link(), model: KEY })).toThrow(/key/);
  });

  it('refuses links that are broken, insecure or unknown', () => {
    expect(readClassLink('#class=%%%')).toBeNull();
    expect(readClassLink('#class=bm90IGpzb24')).toMatchObject({ ok: false, error: /damaged/ });
    expect(validateClassLink({ ...link(), baseUrl: 'http://evil.example.org/v1' })).toMatchObject({ ok: false, error: /https/ });
    expect(validateClassLink({ ...link(), v: 2 })).toMatchObject({ ok: false });
    expect(validateClassLink({ ...link(), baseUrl: undefined })).toMatchObject({ ok: false });
    // Dev endpoints on this computer are fine.
    expect(validateClassLink({ ...link(), baseUrl: 'http://localhost:11434/v1' })).toMatchObject({ ok: true });
  });

  it('keeps only known fields and drops invalid ones', () => {
    const r = validateClassLink({ ...link(), header: 'Cookie', extra: 1, policy: { ageBand: 'college', lock: ['ai', 'bogus', 'art'], moderation: 'maybe' } });
    expect(r.ok && r.link).toEqual({ v: 1, baseUrl: 'https://amble-ai.sau99.org/v1', model: 'amble-default', code: 'MAPLE-7Q2K', name: 'Room 12', policy: { lock: ['ai', 'vision'] } });
  });

  it('expires at the end of the given day', () => {
    const l = link({ policy: { expires: '2027-06-30' } });
    expect(isClassLinkExpired(l, new Date('2027-06-30T20:00:00'))).toBe(false);
    expect(isClassLinkExpired(l, new Date('2027-07-01T00:00:01'))).toBe(true);
    expect(isClassLinkExpired(link(), new Date('2099-01-01'))).toBe(false);
  });

  it('is stored until Disconnect', () => {
    const store = new MemoryStorage();
    saveClassLink(link(), store);
    expect(loadClassLink(store)).toEqual(link());
    clearClassLink(store);
    expect(loadClassLink(store)).toBeNull();
    store.setItem('amble:class-link', '{"link": {"v": 1, "baseUrl": "http://evil.example/v1"}}');
    expect(loadClassLink(store)).toBeNull();
  });

  it('is taken out of the address bar, keeping the rest of the fragment', () => {
    const calls: string[] = [];
    const win = (hash: string) => ({ location: { hash, pathname: '/amble/', search: '?x=1' }, history: { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => calls.push(String(url)) } });
    stripClassLinkFromUrl(win('#class=abc'));
    stripClassLinkFromUrl(win('#/home?class=abc&tab=2'));
    stripClassLinkFromUrl(win('#/home?class=abc'));
    stripClassLinkFromUrl(win('#/home'));
    expect(calls).toEqual(['/amble/?x=1', '/amble/?x=1#/home?tab=2', '/amble/?x=1#/home']);
  });
});

describe('build and managed sources', () => {
  it('reads a district build', () => {
    const l = layerFromEnv({
      VITE_AMBLE_SCHOOL_MODE: 'true',
      VITE_AMBLE_AI_BASE_URL: 'https://amble-ai.sau99.org/v1/',
      VITE_AMBLE_AI_MODEL: 'amble-default',
      VITE_AMBLE_AI_AUTH: 'class-code',
      VITE_AMBLE_AI_CAPS: 'json_schema, stream',
      VITE_AMBLE_ALLOW_ART_TO_AI: 'silhouette',
      VITE_AMBLE_CONTENT_MAX: 'middle',
      VITE_AMBLE_LOCK: 'content',
      VITE_AMBLE_DISTRICT_NAME: 'SAU 99',
      VITE_AMBLE_PRIVACY_URL: 'javascript:alert(1)',
    });
    expect(l).toMatchObject({
      source: 'build',
      schoolMode: true,
      baseUrl: 'https://amble-ai.sau99.org/v1',
      classCodeHeader: 'X-Amble-Class',
      caps: { jsonSchema: true, stream: true, reasoning: false, images: false, moderation: false },
      visionAllowed: true,
      ageBandMax: 'middle',
      lock: ['content'],
      district: { name: 'SAU 99', privacyUrl: '', contact: '' },
    });
    expect(layerFromEnv({ MODE: 'production' })).toBeNull();
    expect(layerFromEnv({ VITE_AMBLE_AI_BASE_URL: 'http://ai.example.org' })?.problems?.[0]).toMatch(/https/);
  });

  it('reads managed configuration, nested or not, and never takes a key from it', () => {
    const raw = { amble: 1, district: { name: 'SAU 99', privacyUrl: 'https://sau99.org/amble' }, ai: { enabled: true, baseUrl: 'https://amble-ai.sau99.org/v1', auth: { type: 'bearer', key: KEY }, gradeBandsWithAI: ['middle', 'high'] }, content: { max: 'high', default: 'middle' }, lock: ['ai'] };
    const l = layerFromManaged(raw);
    expect(l).toMatchObject({ source: 'managed', schoolMode: true, auth: { type: 'none' }, aiBands: ['middle', 'high'], ageBand: 'middle', lock: ['ai'] });
    expect(JSON.stringify(l)).not.toContain(KEY);
    expect(l?.problems?.[0]).toMatch(/keys belong on the proxy/);
    expect(layerFromManaged({ ai: { baseUrl: 'https://x.org/v1', auth: { type: 'class-code', code: 'OAK-1' } } })?.auth).toEqual({ type: 'class-code', header: 'X-Amble-Class', code: 'OAK-1' });
  });

  it('feature-detects navigator.managed and never hangs on it', async () => {
    const nav = (impl: () => Promise<Record<string, unknown>>) => ({ managed: { getManagedConfiguration: impl } });
    expect(await readManagedConfig({})).toBeNull();
    expect(await readManagedConfig(undefined)).toBeNull();
    expect(await readManagedConfig(nav(() => Promise.reject(new Error('not managed'))))).toBeNull();
    expect(await readManagedConfig(nav(() => Promise.resolve({})))).toBeNull();
    expect(await readManagedConfig(nav(() => Promise.resolve({ amble: { ai: { enabled: false } } })))).toEqual({ ai: { enabled: false } });
    expect(await readManagedConfig(nav(() => Promise.resolve({ ai: { enabled: true }, lock: ['ai'] })))).toEqual({ ai: { enabled: true }, lock: ['ai'] });
    expect(await readManagedConfig(nav(() => new Promise(() => {})), 20)).toBeNull();
  });
});

describe('manual settings', () => {
  it('start empty and round-trip', () => {
    const local = new MemoryStorage();
    expect(loadAiSettings({ local })).toEqual(DEFAULT_AI_SETTINGS);
    saveAiSettings(settings({ apiKey: KEY, model: 'gpt-5.1', ageBand: 'high' }), { local });
    expect(loadAiSettings({ local })).toMatchObject({ apiKey: KEY, model: 'gpt-5.1', ageBand: 'high' });
  });

  it('keep the key only for this session when asked', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    saveAiSettings(settings({ apiKey: KEY, rememberKey: false }), { local, session });
    expect(local.getItem('amble:ai-settings')).not.toContain(KEY);
    expect(loadAiSettings({ local, session }).apiKey).toBe(KEY);
    expect(loadAiSettings({ local, session: new MemoryStorage() }).apiKey).toBe('');
    clearAiSettings({ local, session });
    expect(loadAiSettings({ local, session })).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("carry over the old editor's key and models", () => {
    const local = new MemoryStorage();
    local.setItem('amble:settings', JSON.stringify({ useChatGpt: false, apiKey: KEY, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', assetModel: 'gpt-5-nano', artMode: 'svg', imageModel: 'gpt-image-1' }));
    expect(loadAiSettings({ local })).toMatchObject({ apiKey: KEY, baseUrl: '', model: '', fastModel: 'gpt-5-nano' });
  });

  it('make a layer: a key alone means OpenAI; a base URL alone is a keyless proxy', () => {
    expect(layerFromSettings(settings({ apiKey: KEY }))).toMatchObject({ baseUrl: OPENAI_BASE_URL, auth: { type: 'bearer', key: KEY } });
    expect(layerFromSettings(settings({ baseUrl: 'https://llm.home.example/v1/' }))).toMatchObject({ baseUrl: 'https://llm.home.example/v1', auth: { type: 'none' } });
    expect(layerFromSettings(settings())?.baseUrl).toBeUndefined();
  });
});

describe('precedence: managed > build > class link > manual', () => {
  const manualKey = layerFromSettings(settings({ apiKey: KEY }));
  const classLayer = (over: Partial<ClassLink> = {}) => layerFromClassLink(link(over));

  it('has no AI and no default endpoint when nothing is set up', () => {
    const c = mergeLayers([layerFromSettings(settings())]);
    expect(c).toMatchObject({ source: 'none', enabled: false, offReason: 'not-configured', baseUrl: '', manualAllowed: true, ageBand: 'middle' });
    expect(aiAvailable(c)).toBe(false);
    expect(transportFor(c)).toBeNull();
  });

  it('uses a key typed at home', () => {
    const c = mergeLayers([manualKey]);
    expect(c).toMatchObject({ source: 'manual', enabled: true, baseUrl: OPENAI_BASE_URL, model: 'gpt-5', fastModel: 'gpt-5', moderation: 'endpoint', manualAllowed: true });
    expect(describeAiSource(c)).toMatchObject({ title: 'You set this up on this device', detail: 'AI helper on · api.openai.com', managedBySchool: false });
  });

  it("puts a teacher's class link above a typed key, and sends only the class code", () => {
    const c = mergeLayers([manualKey, classLayer()]);
    expect(c).toMatchObject({ source: 'class-link', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' }, model: 'amble-default', classLabel: 'Room 12', manualAllowed: false });
    const t = transportFor(c, { storage: new MemoryStorage() });
    expect(t?.headers).toEqual({ 'X-Amble-Class': 'MAPLE-7Q2K' });
    expect(t?.auth).toBe('class-code');
    expect(describeAiSource(c).title).toBe('Your teacher set this up');
  });

  it("joins a district build's endpoint with a class link's code, only for the same origin", () => {
    const b = build({ baseUrl: 'https://amble-ai.sau99.org/v1', classCodeHeader: 'X-Class', model: 'amble-default' });
    expect(mergeLayers([b, classLayer()])).toMatchObject({ source: 'build', enabled: true, auth: { type: 'class-code', header: 'X-Class', code: 'MAPLE-7Q2K' } });
    const other = mergeLayers([b, classLayer({ baseUrl: 'https://teacher-proxy.example.org/v1', model: 'other' })]);
    expect(other).toMatchObject({ source: 'build', enabled: false, offReason: 'needs-class-link', auth: { type: 'none' }, model: 'amble-default' });
    expect(describeAiSource(other).detail).toMatch(/class link/);
  });

  it('lets managed configuration win, and its locks hold below it', () => {
    const m = managed({ baseUrl: 'https://ai.district.org/v1', auth: { type: 'none' }, lock: ['ai'] });
    const c = mergeLayers([classLayer({ policy: { enabled: false } }), m, build({ baseUrl: 'https://other.org/v1', auth: { type: 'none' } })]);
    expect(c).toMatchObject({ source: 'managed', enabled: true, baseUrl: 'https://ai.district.org/v1', locked: ['ai'], schoolMode: true });
    expect(describeAiSource(c).title).toBe('Your school set this up');
  });

  it('lets any source turn the AI off unless a school locked it', () => {
    const off = mergeLayers([managed({ enabled: false }), classLayer()]);
    expect(off).toMatchObject({ enabled: false, offReason: 'turned-off', offBy: 'managed' });
    expect(describeAiSource(off).detail).toBe('Your school turned the AI helper off.');
    expect(mergeLayers([classLayer({ policy: { enabled: false } })])).toMatchObject({ enabled: false, offBy: 'class-link' });
    expect(mergeLayers([classLayer(), layerFromSettings(settings({ enabled: false }))])).toMatchObject({ enabled: false, offBy: 'manual' });
  });

  it('ignores an expired class link, and says so when nothing else is set up', () => {
    const expired = classLayer({ policy: { expires: '2020-01-01' } });
    expect(mergeLayers([expired, layerFromSettings(settings())])).toMatchObject({ enabled: false, offReason: 'expired', expired: true });
    expect(describeAiSource(mergeLayers([expired])).title).toBe('Your class link has expired');
    expect(mergeLayers([expired, manualKey])).toMatchObject({ source: 'manual', enabled: true, expired: true });
  });

  it('ignores typed keys and the dev server in school mode', () => {
    const dev: ConfigLayer = { source: 'dev', via: 'dev-server', baseUrl: '/api/openai' };
    const c = mergeLayers([build({ schoolMode: true }), manualKey, dev]);
    expect(c).toMatchObject({ source: 'none', enabled: false, schoolMode: true, manualAllowed: false });
  });

  it('turns AI off for grade bands the district left out', () => {
    const m = managed({ baseUrl: 'https://ai.district.org/v1', aiBands: ['middle', 'high'], ageBand: 'elementary' });
    expect(mergeLayers([m])).toMatchObject({ enabled: false, offReason: 'grade-band', ageBand: 'elementary' });
    expect(mergeLayers([managed({ baseUrl: 'https://ai.district.org/v1', aiBands: ['middle', 'high'] })]).enabled).toBe(true);
  });
});

describe('content level', () => {
  it('lets a teacher set the class level under the district ceiling, and a student only go lower', () => {
    const b = build({ ageBandMax: 'middle', ageBand: 'middle' });
    expect(mergeLayers([b, layerFromClassLink(link({ policy: { ageBand: 'high' } }))]).ageBand).toBe('middle');
    expect(mergeLayers([build({ ageBandMax: 'high' }), layerFromClassLink(link({ policy: { ageBand: 'high' } }))]).ageBand).toBe('high');
    expect(mergeLayers([b, layerFromSettings(settings({ ageBand: 'elementary' }))]).ageBand).toBe('elementary');
    expect(mergeLayers([b, layerFromSettings(settings({ ageBand: 'high' }))]).ageBand).toBe('middle');
    expect(mergeLayers([layerFromSettings(settings({ ageBand: 'high' }))]).ageBand).toBe('high');
  });

  it('ignores the student when the school locked content', () => {
    expect(mergeLayers([build({ ageBand: 'middle', lock: ['content'] }), layerFromSettings(settings({ ageBand: 'elementary' }))]).ageBand).toBe('middle');
  });
});

describe('pictures', () => {
  const url = 'https://amble-ai.sau99.org/v1';
  it('are allowed only when every school source that says anything allows them', () => {
    expect(mergeLayers([build({ baseUrl: url, visionAllowed: true }), layerFromClassLink(link({ visionAllowed: false }))]).visionAllowed).toBe(false);
    expect(mergeLayers([build({ baseUrl: url }), layerFromClassLink(link({ visionAllowed: true }))]).visionAllowed).toBe(true);
    expect(mergeLayers([build({ baseUrl: url })]).visionAllowed).toBe(false);
    expect(mergeLayers([build({ baseUrl: url, visionAllowed: true, lock: ['vision'] }), layerFromClassLink(link({ visionAllowed: false }))]).visionAllowed).toBe(true);
  });

  it('are stripped by the transport when not allowed', () => {
    const c = mergeLayers([layerFromSettings(settings({ apiKey: KEY }))]);
    expect(transportFor(c)?.caps.images).toBe(false);
    expect(transportFor({ ...c, visionAllowed: true })?.caps.images).toBeUndefined();
  });
});

describe('resolveAiConfig', () => {
  it('reads every source from the browser (injected here)', async () => {
    const local = new MemoryStorage();
    saveClassLink(link(), local);
    saveAiSettings(settings({ apiKey: KEY, ageBand: 'elementary' }), { local });
    const c = await resolveAiConfig({ env: { VITE_AMBLE_CONTENT_MAX: 'high' }, managed: null, local, session: null, dev: false });
    expect(c).toMatchObject({ source: 'class-link', enabled: true, ageBand: 'elementary', ageBandMax: 'high' });
    expect(modelFor(c, 'fast')).toBe('amble-default');
  });

  it('offers "Sign in with ChatGPT" and the dev key proxy only on the dev server', async () => {
    const local = new MemoryStorage();
    saveAiSettings(settings({ apiKey: KEY, useChatGpt: true }), { local });
    const dev = await resolveAiConfig({ env: {}, managed: null, local, session: null, dev: true, devServer: { codex: true, serverKey: true } });
    expect(dev).toMatchObject({ source: 'dev', via: 'codex', baseUrl: '/api/codex', model: 'gpt-6-astra' });
    expect(transportFor(dev)?.auth).toBe('dev');
    expect(describeAiSource(dev).title).toMatch(/ChatGPT sign-in/);
    const prod = await resolveAiConfig({ env: {}, managed: null, local, session: null, dev: false });
    expect(prod).toMatchObject({ source: 'manual', via: 'endpoint' });
    const serverKey = await resolveAiConfig({ env: {}, managed: null, local: new MemoryStorage(), session: null, dev: true, devServer: { codex: false, serverKey: true } });
    expect(serverKey).toMatchObject({ source: 'dev', via: 'dev-server', baseUrl: '/api/openai' });
    const school = await resolveAiConfig({ env: { VITE_AMBLE_SCHOOL_MODE: 'true' }, managed: null, local, session: null, dev: true, devServer: { codex: true, serverKey: true } });
    expect(school.source).toBe('none');
  });
});

describe('safety identifier', () => {
  it('is a salted hash of a random device id that changes daily and per endpoint', async () => {
    const store = new MemoryStorage();
    const id = deviceId(store);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(deviceId(store)).toBe(id);
    const day1 = await safetyIdentifier({ salt: 'https://a.org', storage: store, now: new Date('2026-10-01T10:00:00Z') });
    expect(day1).toMatch(/^amble_[0-9a-f]{40}$/);
    expect(await safetyIdentifier({ salt: 'https://a.org', storage: store, now: new Date('2026-10-01T23:00:00Z') })).toBe(day1);
    expect(await safetyIdentifier({ salt: 'https://a.org', storage: store, now: new Date('2026-10-02T10:00:00Z') })).not.toBe(day1);
    expect(await safetyIdentifier({ salt: 'https://b.org', storage: store, now: new Date('2026-10-01T10:00:00Z') })).not.toBe(day1);
    expect(day1).not.toContain(id);
  });

  it('is only sent when the config enables it', () => {
    const c = mergeLayers([layerFromClassLink(link({ policy: { safetyIdentifier: true } }))]);
    expect(transportFor(c)?.safetyIdentifier).toBeTypeOf('function');
    expect(transportFor(mergeLayers([layerFromClassLink(link())]))?.safetyIdentifier).toBeUndefined();
  });
});
