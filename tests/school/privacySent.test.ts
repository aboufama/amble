/**
 * The privacy notice must name every part of every AI request: districts inventory it under NH RSA 189:66.
 * src/pipeline/sent.ts maps each part of each request to a line of the notice's list, and this fails when a
 * request gains a part with no line: a field of the build, change and fix message (or of a thing to draw, a
 * dial or an error in it), a line of the plan or explain message, a part of the Magic bones message, a key
 * of a request body or of the moderation check, or a request header. Then every kind of request goes over
 * the wire to a fake school endpoint, and each part of what arrives has to be on the list. Last, the pages
 * show the list, and don't claim what Amble doesn't do.
 */
import { readFileSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBody, type WireOptions } from '../../src/ai/wire/body';
import { mergeLayers, s, toneDownNote, toneHint, transportFor } from '../../src/cores/ai';
import { createHistory } from '../../src/history/api';
import { t, TABLES } from '../../src/i18n';
import type { AiMode, ClassLinkV1, Level } from '../../src/model/types';
import type { AppServicesLike } from '../../src/pipeline/env';
import { explainUserMessage } from '../../src/pipeline/explain';
import { planUserMessage } from '../../src/pipeline/plan';
import { EXPLAIN_PROMPT } from '../../src/pipeline/prompts/explain';
import { PLAN_PROMPT } from '../../src/pipeline/prompts/plan';
import { RIG_PROMPT } from '../../src/pipeline/prompts/rig';
import { SYSTEM_PROMPT } from '../../src/pipeline/prompts/system';
import {
  BODY_FIELDS,
  CAST_LINE_FIELDS,
  DIAL_LINE_FIELDS,
  EXPLAIN_LINES,
  FIX_ERROR_FIELDS,
  HEADER_FIELDS,
  MESSAGE_ROLES,
  MODERATION_FIELDS,
  PLAN_LINES,
  RIG_PARTS,
  SENT_LINES,
  USER_MESSAGE_FIELDS,
} from '../../src/pipeline/sent';
import { createAiService, type AiEnv, type AiEnvConfig } from '../../src/pipeline/service';
import { AiInstructions } from '../../src/screens/pages/AiInstructions';
import { ItPage } from '../../src/screens/pages/ItPage';
import { Privacy, SECURITY_REPORT_URL } from '../../src/screens/pages/Privacy';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { plain, sse } from '../ai/fakeEndpoint';
import { fakeRobot, fixture, robotFail, world } from '../pipeline/helpers';

const BASE = 'https://ai.example.org/v1';

/** The fields of `export interface <name> { ... }` in src/pipeline/userMessage.ts, read from the source. */
function fieldsOf(name: string): string[] {
  const source = readFileSync(new URL('../../src/pipeline/userMessage.ts', import.meta.url), 'utf8');
  const body = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  if (!body) throw new Error(`No interface ${name} in src/pipeline/userMessage.ts`);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

/** The label each line of a message starts with ("Content level: middle" → "Content level"), leaving out fenced data and list items. */
function labelsOf(message: string): string[] {
  const out = new Set<string>();
  let fenced = false;
  for (const line of message.split('\n')) {
    if (line === '<<<' || line === '>>>') {
      fenced = line === '<<<';
      continue;
    }
    if (fenced || line.startsWith('- ')) continue;
    out.add(/^([^:]+?):(\s|$)/.exec(line)?.[1] ?? line);
  }
  return [...out];
}

const unmapped = (keys: Iterable<string>, map: object) => [...keys].filter((k) => !Object.hasOwn(map, k));

describe('every part of an AI request has a line in the privacy notice', () => {
  it('maps every field of the build, change and fix message, and of each thing to draw, dial and error in it', () => {
    expect(Object.keys(USER_MESSAGE_FIELDS).sort()).toEqual(fieldsOf('UserMessageInput'));
    expect(Object.keys(CAST_LINE_FIELDS).sort()).toEqual(fieldsOf('CastLine'));
    expect(Object.keys(DIAL_LINE_FIELDS).sort()).toEqual(fieldsOf('DialLine'));
    expect(Object.keys(FIX_ERROR_FIELDS).sort()).toEqual(fieldsOf('FixError'));
  });

  it('maps every line of the plan message, with and without a hero and content notes', () => {
    const notes = toneDownNote([toneHint('violence', 'elementary')]);
    expect(notes).toMatch(/^Content notes for this request: /);
    const full = `${planUserMessage('a snail who saves her friends', 'elementary', { name: 'Shelly', kind: 'character', rig: 'blob' })}\n${notes}`;
    expect(unmapped(labelsOf(full), PLAN_LINES)).toEqual([]);
    expect(unmapped(labelsOf(planUserMessage('a maze', 'high', null)), PLAN_LINES)).toEqual([]);
    // And the map names no line the message doesn't have.
    expect(unmapped(Object.keys(PLAN_LINES), Object.fromEntries(labelsOf(full).map((l) => [l, 1])))).toEqual([]);
  });

  it('maps every line of the explain message', () => {
    const w = world();
    const file = w.code[0];
    const message = explainUserMessage(w, { path: file.path, from: 1, to: 6, question: 'What does this do?' }, 'middle');
    expect(message).not.toBeNull();
    const labels = labelsOf(message ?? '');
    expect(unmapped(labels, EXPLAIN_LINES)).toEqual([]);
    expect(unmapped(Object.keys(EXPLAIN_LINES), Object.fromEntries(labels.map((l) => [l, 1])))).toEqual([]);
  });

  it('maps every key of a request body with every option on, and every kind of message in it', () => {
    const on: WireOptions = { stream: true, streamUsage: true, format: 'json_schema', effort: true, tokensField: 'max_completion_tokens', store: true, safetyId: true, images: true };
    const req = { model: 'm', system: 'S', user: 'U', messages: [{ role: 'assistant' as const, content: 'A' }, { role: 'user' as const, content: 'Try again' }], maxTokens: 100, reasoningEffort: 'low' as const };
    const json = { schema: s.object({ a: s.string() }).json, name: 'x' };
    const bodies = [buildBody(req, on, json, 'sid'), buildBody(req, { ...on, format: 'json_object', tokensField: 'max_tokens' }, json, 'sid')];
    const keys = new Set(bodies.flatMap((b) => Object.keys(b)));
    expect(unmapped(keys, BODY_FIELDS)).toEqual([]);
    expect(Object.keys(BODY_FIELDS).filter((k) => !keys.has(k))).toEqual([]);
    const roles = bodies.flatMap((b) => (b.messages as Array<{ role: string }>).map((m) => m.role));
    expect(unmapped(roles, MESSAGE_ROLES)).toEqual([]);
  });

  it('maps every request header: one credential at most, the class code or a key', () => {
    const code = transportFor(mergeLayers([{ source: 'class-link', baseUrl: BASE, auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' }, model: 'm' }]), { storage: null });
    const key = transportFor(mergeLayers([{ source: 'manual', baseUrl: BASE, auth: { type: 'bearer', key: 'sk-test-0123456789abcdef' }, model: 'm' }]), { storage: null });
    const none = transportFor(mergeLayers([{ source: 'manual', baseUrl: BASE, auth: { type: 'none' }, model: 'm' }]), { storage: null });
    expect(Object.keys(code?.headers ?? {})).toEqual(['X-Amble-Class']);
    expect(Object.keys(key?.headers ?? {})).toEqual(['Authorization']);
    expect(none?.headers).toEqual({});
    expect(Object.keys(HEADER_FIELDS).sort()).toEqual(['bearer', 'class-code']);
  });
});

// ------------------------------------------------------------------ over the wire

interface Arrived {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** A school endpoint that answers every kind of request and keeps each one exactly as it arrived. */
function schoolEndpoint() {
  const arrived: Arrived[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const url = String(input);
    arrived.push({ url, headers, body });
    if (url.endsWith('/moderations')) {
      const n = Array.isArray(body.input) ? body.input.length : 1;
      return new Response(JSON.stringify({ results: Array.from({ length: n }, () => ({ flagged: false, categories: {} })) }), { headers: { 'content-type': 'application/json' } });
    }
    const format = (body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
    if (format === 'amble_plan') return plain(fixture('plan-snail.json'));
    if (format === 'amble_explain') return plain(JSON.stringify({ answer: 'These lines make the Moon King float.', lines: [], safetyNote: '' }));
    if (format === 'amble_rig') return plain(JSON.stringify({ kind: 'biped', facing: 'viewer', joints: [{ name: 'neck', x: 500, y: 200 }], extras: [] }));
    const user = String((body.messages as Array<{ content: unknown }>)[1].content);
    return sse([fixture(user.startsWith('Task: fix') ? 'fix-ok.patch' : 'change-throws.patch')]);
  };
  return { arrived, fetch };
}

/** The AI service for a class whose district allows outlines, uses moderation and the safety identifier. */
function schoolService(fetch: typeof globalThis.fetch) {
  const ai = mergeLayers([
    {
      source: 'class-link',
      baseUrl: BASE,
      auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' },
      model: 'main-model',
      fastModel: 'fast-model',
      visionModel: 'vision-model',
      visionAllowed: true,
      moderation: 'endpoint',
      safetyIdentifier: true,
      caps: { reasoning: true },
      district: { name: 'SAU 99', privacyUrl: '', contact: '' },
    },
  ]);
  const config: AiEnvConfig = { ai, aiMode: 'on' as AiMode, level: 'middle' as Level, levelMax: 'high' as Level, classLink: null as ClassLinkV1 | null, school: true };
  const services: AppServicesLike = { store: new MemoryStore(), player: { robot: () => Promise.reject(new Error('unused')) }, starters: createStarterCatalog(), history: createHistory() };
  const robot = fakeRobot([robotFail('boss.js', 3, "Cannot read properties of undefined (reading 'amount')")]);
  const env: AiEnv = {
    config: () => config,
    onConfig: () => () => undefined,
    services: () => services,
    transport: (c) => transportFor(c, { fetch, isOnline: () => true, storage: memoryStorage() }),
    robot: () => robot.robot,
    random: () => 0,
    online: () => true,
    onOnline: () => () => undefined,
  };
  return createAiService(env);
}

describe('every request that goes over the wire is on the list', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a plan, a change and its fix, an explanation, Magic bones and the moderation checks', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 64, height: 64, close: () => undefined }));
    const { arrived, fetch } = schoolEndpoint();
    const service = schoolService(fetch as typeof globalThis.fetch);
    const signal = new AbortController().signal;
    const job = { signal, onProgress: () => undefined };

    expect((await service.plan('a snail who saves her friends from a salt king', { level: 'middle', hero: { name: 'Shelly', kind: 'character', rig: 'blob' }, ...job })).kind).toBe('plan');
    expect(await service.change(world(), 'make the moon king stomp', job)).toMatchObject({ kind: 'accepted', repairs: 1 });
    expect((await service.explain(world(), { path: 'game.js', from: 68, to: 75, question: 'What does this do?' }, { signal })).kind).toBe('explained');
    expect(await service.rigHints(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'biped', { signal })).not.toBeNull();

    const kinds = new Set<string>();
    for (const r of arrived) {
      expect(r.url.startsWith(`${BASE}/`), r.url).toBe(true);
      // Headers: the content type, and the class code.
      expect(Object.keys(r.headers).sort()).toEqual(['content-type', 'x-amble-class']);

      if (r.url.endsWith('/moderations')) {
        kinds.add('moderation');
        expect(unmapped(Object.keys(r.body), MODERATION_FIELDS)).toEqual([]);
        continue;
      }
      expect(unmapped(Object.keys(r.body), BODY_FIELDS)).toEqual([]);
      const messages = r.body.messages as Array<{ role: string; content: unknown }>;
      expect(unmapped(messages.map((m) => m.role), MESSAGE_ROLES)).toEqual([]);
      const system = String(messages[0].content);
      const format = (r.body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name;
      const user = messages[1].content;
      if (format === 'amble_plan') {
        kinds.add('plan');
        expect(system.startsWith(PLAN_PROMPT)).toBe(true);
        expect(unmapped(labelsOf(String(user)), PLAN_LINES)).toEqual([]);
      } else if (format === 'amble_explain') {
        kinds.add('explain');
        expect(system.startsWith(EXPLAIN_PROMPT)).toBe(true);
        expect(unmapped(labelsOf(String(user)), EXPLAIN_LINES)).toEqual([]);
      } else if (format === 'amble_rig') {
        kinds.add('rig');
        expect(system.startsWith(RIG_PROMPT)).toBe(true);
        expect(unmapped((user as Array<{ type: string }>).map((p) => p.type), RIG_PARTS)).toEqual([]);
      } else {
        // The build, change and fix message: a pure function of `UserMessageInput`, mapped above.
        kinds.add(/^Task: (\w+)/.exec(String(user))?.[1] ?? 'unknown');
        expect(system.startsWith(SYSTEM_PROMPT)).toBe(true);
      }
    }
    expect([...kinds].sort()).toEqual(['change', 'explain', 'fix', 'moderation', 'plan', 'rig']);
    for (const prompt of [SYSTEM_PROMPT, PLAN_PROMPT, EXPLAIN_PROMPT, RIG_PROMPT]) expect(prompt.length).toBeGreaterThan(200);
  });
});

// ------------------------------------------------------------------ what the pages say

/** A page's words, without markup. */
function words(page: ComponentType): string {
  return renderToStaticMarkup(createElement(page))
    .replace(/<\/?(code|strong)>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

const shown = (key: (typeof SENT_LINES)[number]) => t(key).replace(/`/g, '').replace(/\s+/g, ' ');

describe('the pages', () => {
  it('list every line in the privacy notice and on the AI helper instructions', () => {
    for (const page of [Privacy, AiInstructions]) {
      const text = words(page);
      for (const key of SENT_LINES) expect(text, `${page.name}: ${key}`).toContain(shown(key));
    }
  });

  it('send security problems to private reporting, not a public issue', () => {
    expect(SECURITY_REPORT_URL).toBe('https://github.com/aboufama/amble/security/advisories/new');
    const html = renderToStaticMarkup(createElement(Privacy));
    expect(html).toContain(`<a href="${SECURITY_REPORT_URL}" rel="noreferrer" target="_blank">Report a security problem privately</a>`);
    const school = TABLES.school as Record<string, string>;
    expect(school.page_privacySecurity).not.toMatch(/issue/i);
    expect(school.privContact).not.toMatch(/problem/i);
  });

  it("don't call Amble open source: it has no license", () => {
    for (const [key, text] of Object.entries(TABLES.school as Record<string, string>)) expect(text, key).not.toMatch(/open[- ]?source/i);
  });

  it('claim no screen reader testing, and list only the checks Amble runs', () => {
    const page = (TABLES.school as Record<string, string>).page_a11y;
    const checked = page.split('## How Amble is checked')[1]?.split('## ')[0] ?? '';
    expect(checked).toContain('axe-core');
    expect(checked).not.toMatch(/ChromeVox|NVDA|VoiceOver|screen reader/i);
    expect(page).toContain('Amble has not been tested with a screen reader (ChromeVox, NVDA or VoiceOver) yet.');
  });

  it("keep the developers' ChatGPT sign-in off the IT page", () => {
    expect(words(ItPage)).not.toMatch(/Sign in with ChatGPT|Codex/i);
  });
});
