/** Magic bones' outline consent (§2.11, §5.12): asked per drawing, a yes remembered on the device. */
import { describe, expect, it } from 'vitest';
import { aiHintsAllowed, createConsentMemory, type ConsentSettings } from '../../src/bones/consent';
import type { SettingsMap } from '../../src/model/types';

function fakeSettings(): ConsentSettings & { data: Partial<SettingsMap> } {
  const data: Partial<SettingsMap> = {};
  return {
    data,
    get: async (k) => (data[k] ?? null) as never,
    put: async (k, v) => {
      data[k] = v as never;
    },
  };
}

describe('consent memory per drawing', () => {
  it('asks until the student says yes, then remembers it for that drawing only', async () => {
    const settings = fakeSettings();
    const memory = createConsentMemory(settings);
    expect(await memory.answer('a_one')).toBe('ask');
    await memory.remember('a_one', true, 1234);
    expect(await memory.answer('a_one')).toBe('yes');
    expect(await memory.answer('a_two')).toBe('ask');
    expect(settings.data.consent).toEqual({ a_one: 1234 });
  });

  it('keeps a yes across sessions (it lives in the store)', async () => {
    const settings = fakeSettings();
    await createConsentMemory(settings).remember('a_one', true);
    const later = createConsentMemory(settings);
    expect(await later.answer('a_one')).toBe('yes');
  });

  it('remembers "Just do it here" for this session only', async () => {
    const settings = fakeSettings();
    const memory = createConsentMemory(settings);
    await memory.remember('a_one', false);
    expect(await memory.answer('a_one')).toBe('no');
    expect(settings.data.consent).toBeUndefined();
    expect(await createConsentMemory(settings).answer('a_one')).toBe('ask');
  });

  it('a later yes replaces a no, and forget clears a drawing', async () => {
    const settings = fakeSettings();
    const memory = createConsentMemory(settings);
    await memory.remember('a_one', false);
    await memory.remember('a_one', true, 5);
    expect(await memory.answer('a_one')).toBe('yes');
    await memory.remember('a_two', true, 6);
    await memory.forget('a_one');
    expect(await memory.answer('a_one')).toBe('ask');
    expect(settings.data.consent).toEqual({ a_two: 6 });
  });

  it('treats unreadable settings as no answer yet', async () => {
    const broken: ConsentSettings = { get: async () => Promise.reject(new Error('blocked')), put: async () => undefined };
    expect(await createConsentMemory(broken).answer('a_one')).toBe('ask');
  });
});

describe('when Magic bones may offer the outline', () => {
  const on = { enabled: true, visionAllowed: true, visionModel: 'vision-1' };
  it('needs the district to allow art, a vision model and the AI helper ready', () => {
    expect(aiHintsAllowed(on, 'ready')).toBe(true);
    expect(aiHintsAllowed(null, 'ready')).toBe(false);
    expect(aiHintsAllowed({ ...on, visionAllowed: false }, 'ready')).toBe(false);
    expect(aiHintsAllowed({ ...on, visionModel: '' }, 'ready')).toBe(false);
    expect(aiHintsAllowed({ ...on, enabled: false }, 'ready')).toBe(false);
    for (const s of ['off', 'offline', 'explain-only', 'quota', 'busy'] as const) expect(aiHintsAllowed(on, s)).toBe(false);
  });
});
