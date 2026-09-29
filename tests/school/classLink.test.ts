/**
 * Class links (§2.14, §5.14): what the Teacher desk makes is what a student's Chromebook reads back; https
 * only, never a key; expiry through the end of the day; Join or Switch; the QR code stays scannable; and
 * joining or leaving keeps the store and the config slice in step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layerFromClassLink, layerFromEnv, layerFromManaged } from '../../src/ai';
import { classLinkFromCore, classLinkToCore, encodeClassLink, loadClassLink, mergeLayers, parseClassLink, resolveAiConfig, validateClassLink, type ClassLink } from '../../src/cores/ai';
import { isClassLinkV1 } from '../../src/model/guards';
import type { ClassLinkV1 } from '../../src/model/types';
import { createSchool } from '../../src/school/api';
import { classCodeHeaderFor, classLinkHref, encodeClassLinkV1, MAX_PAYLOAD, payloadFits, readIntake, semesterEnd, shortHref, toBase64Url, UnsafeLinkError } from '../../src/school/classLink';
import { testEndpoint } from '../../src/school/testConnection';
import { makeQr, qrPath, qrScannable } from '../../src/school/qr';
import { getState, resetState } from '../../src/state/store';
import { MemoryStore } from '../../src/store/memory';
import { sampleAssignment, sampleClassLink } from '../foundation/samples';

const fragment = (v: unknown) => `#class=${toBase64Url(JSON.stringify(v))}`;
const NOW = new Date('2026-10-01T12:00:00');

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('making and reading a class link', () => {
  it('reads back exactly what the Teacher desk made, assignment and all', () => {
    const link = sampleClassLink({ cls: 'Salle 12 · Période 3', exp: '2027-01-31', asg: sampleAssignment() });
    const href = classLinkHref(link, 'https://amble.sau99.org/app/?from=poster#/teacher/link');
    expect(href.startsWith('https://amble.sau99.org/app/#class=')).toBe(true);
    const read = parseClassLink(new URL(href).hash, NOW);
    expect(read).toEqual({ ok: true, link });
  });

  it('refuses to make a link that carries a provider key', () => {
    const link = sampleClassLink({ ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789' } } });
    expect(() => encodeClassLinkV1(link)).toThrow(UnsafeLinkError);
  });

  it('reads only https addresses, and nothing key-like', () => {
    const http = { ...sampleClassLink(), ai: { baseUrl: 'http://ai.example/v1', model: 'm', auth: { type: 'none' } } };
    expect(readIntake(fragment(http), null, NOW)).toEqual({ ok: false, reason: 'unsafe' });
    const keyed = { ...sampleClassLink(), ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' } } };
    expect(readIntake(fragment(keyed), null, NOW)).toEqual({ ok: false, reason: 'unsafe' });
  });

  it('flags damaged links and ignores hashes without one', () => {
    expect(readIntake('#class=%%%', null, NOW)).toEqual({ ok: false, reason: 'damaged' });
    expect(readIntake(`#class=${toBase64Url('not json')}`, null, NOW)).toEqual({ ok: false, reason: 'damaged' });
    expect(readIntake('#/trail', null, NOW)).toBeNull();
  });

  it('works through the last day and expires after it', () => {
    expect(readIntake(fragment(sampleClassLink({ exp: '2026-10-01' })), null, NOW)).toMatchObject({ ok: true });
    expect(readIntake(fragment(sampleClassLink({ exp: '2026-09-30' })), null, NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('offers Switch when this Chromebook is in another class', () => {
    const f = fragment(sampleClassLink({ cls: 'Room 12' }));
    expect(readIntake(f, 'Room 7', NOW)).toMatchObject({ ok: true, switchingFrom: 'Room 7' });
    expect(readIntake(f, 'Room 12', NOW)).toMatchObject({ ok: true, switchingFrom: null });
    expect(readIntake(f, null, NOW)).toMatchObject({ ok: true, switchingFrom: null });
  });

  it('ends at the end of the semester', () => {
    expect(semesterEnd(new Date(2026, 8, 29))).toBe('2027-01-31');
    expect(semesterEnd(new Date(2027, 0, 10))).toBe('2027-01-31');
    expect(semesterEnd(new Date(2027, 1, 3))).toBe('2027-06-30');
    expect(semesterEnd(new Date(2027, 6, 1))).toBe('2027-08-31');
  });

  it('shows a short link: the address, then the start of the payload', () => {
    const href = classLinkHref(sampleClassLink({ asg: sampleAssignment() }), 'https://amble.sau99.org/');
    const short = shortHref(href);
    expect(short.length).toBeLessThanOrEqual(58);
    expect(short.startsWith('amble.sau99.org/#class=eyJ')).toBe(true);
    expect(short.endsWith('…')).toBe(true);
  });
});

describe('payload size and the QR code', () => {
  it('keeps a class with an assignment well inside 2 KB and a scannable QR code', () => {
    const link = sampleClassLink({ exp: '2027-01-31', asg: sampleAssignment() });
    expect(payloadFits(link)).toBe(true);
    const href = classLinkHref(link, 'https://amble.sau99.org/');
    const qr = makeQr(href);
    expect(qr.version).toBeLessThanOrEqual(25);
    expect(qrScannable(href)).toBe(true);
    expect(qrPath(qr)).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });

  it('says no when the payload is too big for a link', () => {
    const goals = Array.from({ length: 40 }, (_, i) => ({ id: `g_${i}`, label: `A long teacher goal number ${i} that goes on and on for a while`, kind: 'teacher' as const }));
    const link: ClassLinkV1 = sampleClassLink({ asg: sampleAssignment({ goals }) });
    expect(encodeClassLinkV1(link).length).toBeGreaterThan(MAX_PAYLOAD);
    expect(payloadFits(link)).toBe(false);
    expect(qrScannable('x'.repeat(3000))).toBe(false);
  });

  it('uses medium error correction for short links and low for long ones', () => {
    expect(makeQr('https://amble.sau99.org/#class=abc').level).toBe('M');
    expect(makeQr(`https://amble.sau99.org/#class=${'a'.repeat(600)}`).level).toBe('L');
  });
});

describe("the AI core's flat format and the app's", () => {
  const BASE = 'https://amble-ai.sau99.org/v1';
  /** A flat-format link with every field set. */
  const flat: ClassLink = {
    v: 1,
    baseUrl: BASE,
    model: 'amble-default',
    fastModel: 'amble-fast',
    visionModel: 'amble-vision',
    visionAllowed: true,
    code: 'MAPLE-7Q2K',
    header: 'X-Class',
    name: 'Room 12 · Period 3',
    district: 'SAU 99',
    policy: {
      enabled: true,
      mode: 'explain',
      ageBand: 'high',
      moderation: 'endpoint',
      lock: ['content', 'vision'],
      safetyIdentifier: true,
      caps: ['json_schema', 'stream'],
      expires: '2027-01-31',
      requestsMayBeReviewed: true,
    },
  };
  /** An app-format link with every field the flat format holds (the assignment stays in the app's copy). */
  const app: ClassLinkV1 = {
    v: 1,
    cls: 'Room 9 · Period 1',
    district: 'SAU 99',
    ai: {
      baseUrl: BASE,
      model: 'amble-default',
      fastModel: 'amble-fast',
      visionModel: 'amble-vision',
      caps: 'json_schema,reasoning',
      auth: { type: 'class-code', header: 'X-Class', code: 'OAK-44' },
      visionAllowed: false,
      moderation: 'provider',
      lock: ['ai'],
      safetyIdentifier: false,
      requestsMayBeReviewed: false,
    },
    mode: 'explain',
    level: 'elementary',
    exp: '2027-06-30',
    asg: null,
  };

  it('keeps every field of a flat link through joining: flat → app → flat', () => {
    expect(validateClassLink(flat)).toEqual({ ok: true, link: flat });
    const joined = classLinkFromCore(flat);
    expect(joined.ai).toMatchObject({ visionAllowed: true, moderation: 'endpoint', lock: ['content', 'vision'], safetyIdentifier: true, requestsMayBeReviewed: true });
    expect(joined).toMatchObject({ mode: 'explain', level: 'high', exp: '2027-01-31' });
    expect(isClassLinkV1(joined)).toBe(true);
    expect(classLinkToCore(joined)).toEqual(flat);
  });

  it('keeps every field of an app link: app → flat → app, in each AI mode', () => {
    for (const mode of ['on', 'explain', 'off'] as const) {
      const link = { ...app, mode };
      expect(classLinkFromCore(classLinkToCore(link)!)).toEqual(link);
    }
    expect(classLinkFromCore(classLinkToCore({ ...app, ai: { ...app.ai!, auth: { type: 'none' } } })!)).toEqual({ ...app, ai: { ...app.ai!, auth: { type: 'none' } } });
  });

  it('joins a flat link from the address bar with its policy, and the AI config follows it', async () => {
    const read = parseClassLink(`#class=${encodeClassLink(flat)}`, NOW);
    expect(read?.ok).toBe(true);
    if (!read?.ok) return;
    const store = new MemoryStore();
    const local = memoryStorage();
    vi.stubGlobal('localStorage', local);
    try {
      await createSchool(store).join(read.link);
      // The copy the AI core reads is the link the teacher's district made, field for field.
      expect(loadClassLink(local)).toEqual(flat);
      expect(await store.settings.get('classLink')).toEqual(read.link);
      const ai = await resolveAiConfig({ env: {}, managed: null, local, session: null, dev: false, devServer: null, now: NOW });
      expect(ai).toMatchObject({ source: 'class-link', enabled: true, visionAllowed: true, moderation: 'endpoint', locked: ['content', 'vision'], safetyIdentifier: true, requestsMayBeReviewed: true, ageBand: 'high' });
      expect(ai.auth).toEqual({ type: 'class-code', header: 'X-Class', code: 'MAPLE-7Q2K' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads the same policy from the Teacher desk's format, dropping values it doesn't know", () => {
    const withPolicy = { ...sampleClassLink(), ai: { baseUrl: BASE, model: 'm', auth: { type: 'none' }, visionAllowed: true, moderation: 'maybe', lock: ['ai', 'art', 'bogus'], safetyIdentifier: 'yes', requestsMayBeReviewed: true } };
    const read = readIntake(fragment(withPolicy), null, NOW);
    expect(read).toMatchObject({ ok: true });
    if (!read?.ok) return;
    expect(read.link.ai).toEqual({ baseUrl: BASE, model: 'm', auth: { type: 'none' }, visionAllowed: true, lock: ['ai', 'vision'], requestsMayBeReviewed: true });
  });
});

describe("the class code's header on the Teacher desk", () => {
  const BASE = 'https://amble-ai.sau99.org/v1';

  it("follows the district's header from a build or a managed configuration, else X-Amble-Class", () => {
    const built = mergeLayers([layerFromEnv({ VITE_AMBLE_AI_BASE_URL: BASE, VITE_AMBLE_AI_AUTH: 'class-code', VITE_AMBLE_AI_AUTH_HEADER: 'X-District-Class' })]);
    expect(built.classCodeHeader).toBe('X-District-Class');
    expect(classCodeHeaderFor(built)).toBe('X-District-Class');
    const managed = mergeLayers([layerFromManaged({ ai: { baseUrl: BASE, auth: { type: 'class-code', header: 'X-Sau99-Code' } } })]);
    expect(classCodeHeaderFor(managed)).toBe('X-Sau99-Code');
    const districtWide = mergeLayers([layerFromManaged({ ai: { baseUrl: BASE, auth: { type: 'class-code', header: 'X-Sau99-Code', code: 'ALL-SCHOOLS' } } })]);
    expect(classCodeHeaderFor(districtWide)).toBe('X-Sau99-Code');
    // No district header: the default. A class link's own header is not the district's.
    expect(classCodeHeaderFor(mergeLayers([layerFromEnv({ VITE_AMBLE_AI_BASE_URL: BASE, VITE_AMBLE_AI_AUTH: 'class-code' })]))).toBe('X-Amble-Class');
    expect(classCodeHeaderFor(mergeLayers([layerFromEnv({ VITE_AMBLE_AI_BASE_URL: BASE, VITE_AMBLE_AI_AUTH: 'none' })]))).toBe('X-Amble-Class');
    expect(classCodeHeaderFor(mergeLayers([layerFromClassLink({ v: 1, baseUrl: BASE, code: 'OAK-1', header: 'X-Teacher' })]))).toBe('X-Amble-Class');
    expect(classCodeHeaderFor(null)).toBe('X-Amble-Class');
  });

  it("sends the live test's class code in that header", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await testEndpoint({ baseUrl: BASE, model: 'amble-default', auth: { type: 'class-code', header: 'X-District-Class', code: 'MAPLE-7Q2K' } });
      expect(result.ok).toBe(true);
      expect(seen[0]['x-district-class']).toBe('MAPLE-7Q2K');
      expect(seen[0]['x-amble-class']).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('joining and leaving', () => {
  afterEach(() => resetState());

  it('keeps the class in the store and the config slice', async () => {
    const store = new MemoryStore();
    const school = createSchool(store);
    await school.join(sampleClassLink());
    expect(await store.settings.get('classLink')).toEqual(sampleClassLink());
    expect(getState().config.classLink?.cls).toBe('Room 12');
    expect(school.readClassLink(fragment(sampleClassLink({ cls: 'Room 7' })))).toMatchObject({ ok: true, switchingFrom: 'Room 12' });
    await school.leave();
    expect(await store.settings.get('classLink')).toBeNull();
    expect(getState().config.classLink).toBeNull();
  });

  it('restores the joined class at boot', async () => {
    const store = new MemoryStore();
    await store.settings.put('classLink', sampleClassLink({ cls: 'Room 9' }));
    createSchool(store);
    await new Promise((r) => setTimeout(r, 10));
    expect(getState().config.classLink?.cls).toBe('Room 9');
  });
});
