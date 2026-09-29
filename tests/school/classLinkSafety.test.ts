/**
 * A class link is data from outside (a chat, a poster, a classmate): the Join card must only ever see a
 * link the rest of Amble accepts too. What a student's Chromebook reads is checked as hard as the AI
 * core checks its own copy: the whole §4.2 shape (the assignment too), no key hidden in the AI address,
 * a real header name, a printable class code. And a class code a teacher types with a space in it
 * reaches the AI service, as the Teacher desk's live test promised.
 */
import { describe, expect, it } from 'vitest';
import { classLinkToCore, loadClassLink, parseClassLink, resolveAiConfig, saveClassLink } from '../../src/cores/ai';
import { readIntake, toBase64Url } from '../../src/school/classLink';
import { joinHost } from '../../src/screens/join/JoinCard';
import { sampleAssignment, sampleClassLink } from '../foundation/samples';

const fragment = (v: unknown) => `#class=${toBase64Url(JSON.stringify(v))}`;
const NOW = new Date('2026-10-01T12:00:00');

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('reading a class link from outside', () => {
  it('still reads a good link with its assignment', () => {
    const link = sampleClassLink({ asg: sampleAssignment() });
    expect(readIntake(fragment(link), null, NOW)).toEqual({ ok: true, link, switchingFrom: null });
  });

  it('refuses an assignment that is not an assignment', () => {
    for (const asg of [{ title: { b: 'not text' } }, { ...sampleAssignment(), goals: 'all of them' }, { ...sampleAssignment(), starter: 'not-a-starter' }, { ...sampleAssignment(), title: 'x'.repeat(500) }]) {
      expect(readIntake(fragment(sampleClassLink({ asg: asg as never })), null, NOW)).toEqual({ ok: false, reason: 'damaged' });
    }
  });

  it('refuses a key hidden in the AI address', () => {
    for (const baseUrl of ['https://proxy.example/v1?api_key=0123456789abcdef0123', 'https://proxy.example/v1?key=AbCdEf0123456789XyZ98765', 'https://user:pass@proxy.example/v1']) {
      const link = sampleClassLink({ ai: { baseUrl, model: 'm', auth: { type: 'none' } } });
      expect(readIntake(fragment(link), null, NOW)).toEqual({ ok: false, reason: 'unsafe' });
    }
  });

  it('refuses a header that is not a header name, and a class code that is not printable', () => {
    for (const header of ['X-Amble-Class\r\nX-Other: 1', 'Cookie', 'Content-Type', 'two words', '']) {
      const link = sampleClassLink({ ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header, code: 'TEST-1234' } } });
      expect(readIntake(fragment(link), null, NOW)).toMatchObject({ ok: false });
    }
    const link = sampleClassLink({ ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'TEST\n1234' } } });
    expect(readIntake(fragment(link), null, NOW)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('refuses an AI address too long to keep', () => {
    const link = sampleClassLink({ ai: { baseUrl: `https://ai.test/${'v'.repeat(400)}`, model: 'm', auth: { type: 'none' } } });
    expect(readIntake(fragment(link), null, NOW)).toEqual({ ok: false, reason: 'damaged' });
  });

  it('never hands the Join card a link the AI core would drop', () => {
    const read = parseClassLink(fragment(sampleClassLink({ asg: sampleAssignment() })), NOW);
    expect(read?.ok).toBe(true);
    if (!read?.ok) return;
    const core = classLinkToCore(read.link);
    const storage = memoryStorage();
    saveClassLink(core!, storage);
    expect(loadClassLink(storage)).toMatchObject({ baseUrl: 'https://ai.test/v1', code: 'TEST-1234', header: 'X-Amble-Class' });
  });
});

describe('a class code with a space in it', () => {
  it('reaches the AI service in its header, as the live test on the Teacher desk promised', async () => {
    const link = sampleClassLink({ ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE 7Q2K' } } });
    const read = readIntake(fragment(link), null, NOW);
    expect(read).toMatchObject({ ok: true });
    const storage = memoryStorage();
    saveClassLink(classLinkToCore(link)!, storage);
    expect(loadClassLink(storage)?.code).toBe('MAPLE 7Q2K');
    const config = await resolveAiConfig({ local: storage, session: null, env: {}, managed: null, dev: false, now: NOW });
    expect(config.auth).toEqual({ type: 'class-code', header: 'X-Amble-Class', code: 'MAPLE 7Q2K' });
  });
});

describe('the Join card', () => {
  it('names the address the words will go to, so a link to somewhere else looks different', () => {
    expect(joinHost(sampleClassLink())).toBe('ai.test');
    expect(joinHost(sampleClassLink({ ai: { baseUrl: 'https://ai.sau99.org:8443/v1', model: 'm', auth: { type: 'none' } } }))).toBe('ai.sau99.org:8443');
    expect(joinHost(sampleClassLink({ mode: 'off' }))).toBeNull();
    expect(joinHost(sampleClassLink({ ai: null }))).toBeNull();
  });
});
