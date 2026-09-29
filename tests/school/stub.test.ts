/** M7's starting point (FOUNDATION-STUB test; M7 replaces it): reading, joining and leaving a class. */
import { afterEach, describe, expect, it } from 'vitest';
import { createSchoolStub } from '../../src/school/api';
import { getState, resetState } from '../../src/state/store';
import { MemoryStore } from '../../src/store/memory';
import { sampleClassLink } from '../foundation/samples';

const payload = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('school (stub)', () => {
  afterEach(() => resetState());

  it('reads the spec payload, and flags expired and damaged links', () => {
    const school = createSchoolStub(new MemoryStore());
    expect(school.readClassLink(`#class=${payload(sampleClassLink())}`)).toEqual({ ok: true, link: sampleClassLink(), switchingFrom: null });
    expect(school.readClassLink(`#class=${payload(sampleClassLink({ exp: '2020-01-01' }))}`)).toEqual({ ok: false, reason: 'expired' });
    expect(school.readClassLink('#class=%%%')).toEqual({ ok: false, reason: 'damaged' });
    expect(school.readClassLink('#/trail')).toBeNull();
  });

  it('joins and leaves a class', async () => {
    const store = new MemoryStore();
    const school = createSchoolStub(store);
    await school.join(sampleClassLink());
    expect(await store.settings.get('classLink')).toEqual(sampleClassLink());
    expect(getState().config.classLink?.cls).toBe('Room 12');
    await school.leave();
    expect(await store.settings.get('classLink')).toBeNull();
    expect(getState().config.classLink).toBeNull();
  });
});
