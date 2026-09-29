/**
 * The config slice (§5.13, §5.14): the AI core resolves managed > build > class link > manual, locks keep a
 * class link or manual settings from changing what a district set, and a class link (or an assignment) can
 * lower the AI mode and content level but never raise them.
 */
import { describe, expect, it } from 'vitest';
import { classLinkToCore, DEFAULT_AI_SETTINGS, resolveAiConfig, saveAiSettings, saveClassLink, type AiConfig } from '../../src/cores/ai';
import type { ClassLinkV1 } from '../../src/model/types';
import { capLink } from '../../src/school/classLink';
import { deriveConfig, effectiveAiMode, effectiveLevel, lowerLevel, lowerMode } from '../../src/state/config';
import { sampleClassLink } from '../foundation/samples';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    clear: () => m.clear(),
  };
}

const NOW = new Date('2026-10-01T12:00:00');

async function resolveWith(o: { link?: ClassLinkV1; manual?: { baseUrl: string; model?: string }; env?: Record<string, unknown>; managed?: Record<string, unknown> | null }): Promise<AiConfig> {
  const local = memoryStorage();
  const session = memoryStorage();
  if (o.link) {
    const core = classLinkToCore(o.link);
    if (core) saveClassLink(core, local);
  }
  if (o.manual) saveAiSettings({ ...DEFAULT_AI_SETTINGS, baseUrl: o.manual.baseUrl, model: o.manual.model ?? 'manual-model' }, { local, session });
  return resolveAiConfig({ env: o.env ?? {}, managed: o.managed ?? null, local, session, dev: false, devServer: null, now: NOW });
}

const MANAGED = {
  amble: 1,
  district: { name: 'SAU 99', privacyUrl: 'https://sau99.org/amble-privacy', contact: 'tech@sau99.org' },
  ai: { enabled: true, baseUrl: 'https://amble-ai.sau99.org/v1', model: 'amble-default', auth: { type: 'class-code', header: 'X-Amble-Class' } },
  content: { max: 'middle', default: 'middle' },
  lock: ['ai', 'content'],
};

describe('resolving the AI configuration', () => {
  it('turns the AI on from a class link alone, at the class level', async () => {
    const link = sampleClassLink({ level: 'high' });
    const ai = await resolveWith({ link });
    expect(ai.enabled).toBe(true);
    expect(ai.baseUrl).toBe('https://ai.test/v1');
    const derived = deriveConfig(ai, link, false);
    expect(derived.aiMode).toBe('on');
    expect(derived.level).toBe('high');
  });

  it('keeps a district lock over a class link: the address and the ceiling stay the district’s', async () => {
    const link = sampleClassLink({ level: 'high', ai: { baseUrl: 'https://other.example/v1', model: 'x', auth: { type: 'none' } } });
    const ai = await resolveWith({ link, managed: MANAGED });
    expect(ai.baseUrl).toBe('https://amble-ai.sau99.org/v1');
    expect(ai.ageBandMax).toBe('middle');
    const derived = deriveConfig(ai, link, false);
    expect(derived.level).toBe('middle');
    expect(derived.levelMax).toBe('middle');
    expect(derived.school).toBe(true);
  });

  it('lets build settings beat a class link and a class link beat manual settings', async () => {
    const env = { VITE_AMBLE_AI_BASE_URL: 'https://build.example/v1', VITE_AMBLE_AI_MODEL: 'build-model' };
    const built = await resolveWith({ env, link: sampleClassLink() });
    expect(built.baseUrl).toBe('https://build.example/v1');
    const linked = await resolveWith({ link: sampleClassLink(), manual: { baseUrl: 'https://manual.example/v1' } });
    expect(linked.baseUrl).toBe('https://ai.test/v1');
    const manual = await resolveWith({ manual: { baseUrl: 'https://manual.example/v1' } });
    expect(manual.baseUrl).toBe('https://manual.example/v1');
    expect(deriveConfig(manual, null, false).aiMode).toBe('on');
  });

  it('follows the class link’s mode: explain only, or off', async () => {
    const explain = sampleClassLink({ mode: 'explain' });
    expect(deriveConfig(await resolveWith({ link: explain }), explain, false).aiMode).toBe('explain');
    const off = sampleClassLink({ mode: 'off' });
    expect(deriveConfig(await resolveWith({ link: off }), off, false).aiMode).toBe('off');
  });

  it('is off with nothing set up', async () => {
    const ai = await resolveWith({});
    expect(ai.enabled).toBe(false);
    expect(deriveConfig(ai, null, false).aiMode).toBe('off');
  });
});

describe('lowering, never raising', () => {
  it('picks the more careful mode and level', () => {
    expect(lowerMode('on', 'explain')).toBe('explain');
    expect(lowerMode('off', 'on')).toBe('off');
    expect(lowerLevel('high', 'elementary')).toBe('elementary');
    expect(lowerLevel('middle', 'high')).toBe('middle');
  });

  it('lets an assignment lower the class’s mode and level but not raise them', () => {
    expect(effectiveAiMode({ ai: 'off' }, { aiMode: 'on' })).toBe('off');
    expect(effectiveAiMode({ ai: 'on' }, { aiMode: 'explain' })).toBe('explain');
    expect(effectiveAiMode(null, { aiMode: 'explain' })).toBe('explain');
    expect(effectiveLevel({ level: 'elementary' }, { level: 'high' })).toBe('elementary');
    expect(effectiveLevel({ level: 'high' }, { level: 'middle' })).toBe('middle');
    expect(effectiveLevel({ level: null }, { level: 'middle' })).toBe('middle');
  });

  it('caps a link to the district: a class link can lower the AI and level, never raise them', () => {
    const link = sampleClassLink({ level: 'high', mode: 'on', asg: { id: 'as_1', title: 'Boss week', text: '', starter: 'moon-king', require: [], goals: [], ai: 'on', level: 'high', due: '', locked: {} } });
    const capped = capLink(link, { levelMax: 'middle', aiAllowed: true });
    expect(capped.level).toBe('middle');
    expect(capped.asg?.level).toBe('middle');
    expect(capped.mode).toBe('on');
    const off = capLink(link, { levelMax: 'high', aiAllowed: false });
    expect(off.mode).toBe('off');
    expect(off.asg?.ai).toBe('off');
  });

  it('never turns the AI on when the resolved config is off, whatever the link says', () => {
    const off = { enabled: false, expired: false, ageBand: 'middle', ageBandMax: 'high', schoolMode: false, sharedDevice: false } as unknown as AiConfig;
    expect(deriveConfig(off, sampleClassLink({ mode: 'on' }), false).aiMode).toBe('off');
  });
});
