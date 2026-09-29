/**
 * The privacy notice (#/privacy) says what an AI request carries and what it never carries. A real change
 * request, over the wire, must match it: the world's name and the line numbers the student changed or the
 * teacher locked go out (§5.5 "keep them"), so the notice lists them, and never promises otherwise.
 */
import { describe, expect, it } from 'vitest';
import { mergeLayers, transportFor, type AiConfig } from '../../src/cores/ai';
import { createHistory } from '../../src/history/api';
import { t } from '../../src/i18n';
import type { AiMode, ClassLinkV1, CodeFile, Level } from '../../src/model/types';
import type { AppServicesLike } from '../../src/pipeline/env';
import { SENT_LINES } from '../../src/pipeline/sent';
import { createAiService, type AiEnv, type AiEnvConfig } from '../../src/pipeline/service';
import { createStarterCatalog } from '../../src/starters/api';
import { MemoryStore } from '../../src/store/memory';
import { fakeEndpoint, sse } from '../ai/fakeEndpoint';
import { fakeRobot, fixture, world } from './helpers';

function config(): AiConfig {
  return mergeLayers([{ source: 'class-link', baseUrl: 'https://ai.example.org/v1', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE-7Q2K' }, model: 'main-model', moderation: 'local-only', caps: {} }]);
}

async function sentChange(): Promise<string> {
  const endpoint = fakeEndpoint([sse([fixture('change-stomp.patch')])]);
  const store = new MemoryStore();
  const cfg: AiEnvConfig = { ai: config(), aiMode: 'on' as AiMode, level: 'middle' as Level, levelMax: 'high' as Level, classLink: null as ClassLinkV1 | null, school: true };
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
  const w = world();
  const game = w.code[0];
  const lines = game.source.split('\n').length;
  const edited: CodeFile = { ...game, authors: [['starter', lines - 3], ['student', 3]], locked: [[1, 2]] };
  await createAiService(env).change({ ...w, code: [edited] }, 'let me stomp the grumbles', { signal: new AbortController().signal, onProgress: () => undefined });
  const body = JSON.parse(String(endpoint.sent[0].init.body)) as { messages: Array<{ role: string; content: string }> };
  return body.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('the privacy notice and the wire', () => {
  it('lists what a change request really carries, and promises nothing it breaks', async () => {
    const user = await sentChange();
    // What went out: the world's name, and the line numbers the student changed and the teacher locked.
    expect(user).toContain('World: "Pop the Moon"');
    expect(user).toMatch(/The student's own edits \(keep them\): game\.js lines \d+-\d+/);
    expect(user).toContain('Locked by the teacher (never change): game.js lines 1-2');

    // The notice is its intro, the list of what a request carries (one line each), then the rest.
    const sent = [t('school.page_privacyAiIntro'), ...SENT_LINES.map((key) => t(key))].join('\n');
    const [, never] = t('school.page_privacyAiRest').split('**Never sent:**');
    expect(sent).toMatch(/the title and code of the world/);
    expect(sent).toMatch(/which lines .*changed.*locked/);
    expect(never).not.toMatch(/who wrote which lines/);
  });
});
