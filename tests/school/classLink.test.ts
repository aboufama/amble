/**
 * Class links (§2.14, §5.14): what the Teacher desk makes is what a student's Chromebook reads back; https
 * only, never a key; expiry through the end of the day; Join or Switch; the QR code stays scannable; and
 * joining or leaving keeps the store and the config slice in step.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { parseClassLink } from '../../src/cores/ai';
import type { ClassLinkV1 } from '../../src/model/types';
import { createSchool } from '../../src/school/api';
import { classLinkHref, encodeClassLinkV1, MAX_PAYLOAD, payloadFits, readIntake, semesterEnd, shortHref, toBase64Url, UnsafeLinkError } from '../../src/school/classLink';
import { makeQr, qrPath, qrScannable } from '../../src/school/qr';
import { getState, resetState } from '../../src/state/store';
import { MemoryStore } from '../../src/store/memory';
import { sampleAssignment, sampleClassLink } from '../foundation/samples';

const fragment = (v: unknown) => `#class=${toBase64Url(JSON.stringify(v))}`;
const NOW = new Date('2026-10-01T12:00:00');

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
