/**
 * Ids and content addresses (§4.2), the Trail's index derived from a world (§4.3), and autosave's
 * debounce, idle write and flush on hide (§4.4) with fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobRefOf, CAST_KEY_RE, CODE_PATH_RE, hexOfRef, ID_RE, isBlobRef, isCastKey, isCodePath, sha256Hex, sha256Js, uid } from '../../src/model/ids';
import type { SaveState } from '../../src/model/types';
import { createAutosave } from '../../src/store/autosave';
import { MemoryStore } from '../../src/store/memory';
import { deriveMeta, heroArt, sortMetas } from '../../src/store/meta';
import type { Commit, Store } from '../../src/store/api';
import { REF_A, sampleArt, sampleAssignment, samplePlan, sampleWorld } from './samples';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('ids', () => {
  it('makes prefixed crypto-random ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid('w_')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ID_RE);
    expect(uid('a_')).toMatch(/^a_[0-9a-z]{10}$/);
  });

  it('checks cast keys, code paths and blob refs', () => {
    expect(['hero', 'moonKing', 'a1'].every(isCastKey)).toBe(true);
    expect(['Hero', '1a', 'moon-king', 'x'.repeat(25), ''].some(isCastKey)).toBe(false);
    expect(['game.js', 'boss.js', 'my-level2.js'].every(isCodePath)).toBe(true);
    expect(['Game.js', 'game.ts', '../game.js', 'a/b.js', '.js'].some(isCodePath)).toBe(false);
    expect(isBlobRef(REF_A)).toBe(true);
    expect(isBlobRef('sha256:ABC')).toBe(false);
    expect(hexOfRef(REF_A)).toBe('a'.repeat(64));
    expect(CAST_KEY_RE.source).toBe('^[a-z][A-Za-z0-9]{0,23}$');
    expect(CODE_PATH_RE.test('game.js')).toBe(true);
  });

  it('hashes like SHA-256 (the JS fallback agrees with Web Crypto)', async () => {
    expect(hex(sha256Js(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256Js(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const n of [1, 55, 56, 64, 65, 1000, 70_000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(hex(sha256Js(bytes))).toBe(await sha256Hex(bytes));
    }
  });

  it('addresses blobs by content', async () => {
    const a = await blobRefOf(new Blob(['same bytes']));
    const b = await blobRefOf(new Blob(['same bytes'], { type: 'image/png' }));
    const c = await blobRefOf(new Blob(['other bytes']));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isBlobRef(a)).toBe(true);
  });
});

describe('world meta', () => {
  it('is derived from the world', () => {
    const w = sampleWorld({ assignment: sampleAssignment(), handIn: { fileName: 'x.amble', savedAt: 5, method: 'download', turnedInAt: 9 } });
    const meta = deriveMeta(w, null, { art: () => sampleArt() });
    expect(meta).toMatchObject({
      id: w.id,
      title: w.title,
      snapshot: null,
      hero: 'a_hero000001',
      walkers: ['a_hero000001'],
      drawn: 1,
      needed: 2,
      origin: 'starter',
      assignment: { title: 'Boss Battle Week', due: 'Friday' },
      handedIn: 9,
      putAwayAt: null,
    });
    expect(meta.bytes).toBe(new TextEncoder().encode(JSON.stringify(w)).length);
  });

  it('keeps the snapshot and put-away time across commits', () => {
    const w = sampleWorld();
    const prev = { ...deriveMeta(w, null, { snapshot: REF_A }), putAwayAt: 42 };
    const next = deriveMeta({ ...w, title: 'Renamed' }, prev);
    expect(next).toMatchObject({ title: 'Renamed', snapshot: REF_A, putAwayAt: 42 });
    expect(deriveMeta(w, prev, { snapshot: null }).snapshot).toBeNull();
  });

  it('finds the hero by key, then by plan, then any drawing', () => {
    const w = sampleWorld();
    expect(heroArt(w)).toBe('a_hero000001');
    const noHero = sampleWorld({ cast: { saltKing: { key: 'saltKing', art: 'a_salt', madeBy: 'student', extra: null, laterUntil: 0 }, other: { key: 'other', art: 'a_other', madeBy: 'student', extra: null, laterUntil: 0 } } });
    expect(heroArt({ ...noHero, plan: samplePlan({ cast: [{ ...samplePlan().cast[1], key: 'other' }] }) })).toBe('a_other');
    expect(heroArt(noHero)).toBe('a_salt');
  });

  it('sorts the Trail by last opened', () => {
    const a = { ...deriveMeta(sampleWorld({ id: 'w_a' }), null), openedAt: 1 };
    const b = { ...deriveMeta(sampleWorld({ id: 'w_b' }), null), openedAt: 3 };
    expect(sortMetas([a, b]).map((m) => m.id)).toEqual(['w_b', 'w_a']);
  });
});

describe('autosave (§4.4)', () => {
  class Target extends EventTarget {
    document = { visibilityState: 'visible' as DocumentVisibilityState };
  }

  let commits: Commit[];
  let store: Store;
  let states: SaveState[];

  /** An IndexedDB-mode store double that records commits (and can fail them). */
  function fakeStore(fail?: () => Error | null): Store {
    const mem = new MemoryStore();
    return Object.assign(Object.create(mem) as Store, {
      mode: 'idb' as const,
      commit: async (c: Commit) => {
        const err = fail?.();
        if (err) throw err;
        commits.push(c);
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    commits = [];
    states = [];
    store = fakeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces edits for 800 ms, then writes the latest version in one commit', async () => {
    const saver = createAutosave(store, { target: new Target(), onState: (s) => states.push(s) });
    saver.schedule(sampleWorld({ title: 'One' }));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule(sampleWorld({ title: 'Two' }), { blobs: [new Blob(['x'])] });
    await vi.advanceTimersByTimeAsync(700);
    expect(commits).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2100);
    expect(commits).toHaveLength(1);
    expect(commits[0].worlds?.map((w) => w.title)).toEqual(['Two']);
    expect(commits[0].blobs).toHaveLength(1);
    expect(states).toEqual(['saved']);
    expect(saver.pending()).toBe(false);
    saver.dispose();
  });

  it('writes everything at once on pagehide and when the tab is hidden', async () => {
    const target = new Target();
    const saver = createAutosave(store, { target });
    saver.schedule(sampleWorld());
    target.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toHaveLength(1);
    saver.schedule(sampleWorld({ title: 'Later' }));
    target.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toHaveLength(1);
    target.document.visibilityState = 'hidden';
    target.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(commits).toHaveLength(2);
    saver.dispose();
  });

  it('turns to "full" on a quota error, keeps the work and retries with the next change', async () => {
    let fail = true;
    store = fakeStore(() => (fail ? new DOMException('No space', 'QuotaExceededError') : null));
    const errors: unknown[] = [];
    const saver = createAutosave(store, { target: new Target(), onState: (s) => states.push(s), onError: (e) => errors.push(e) });
    saver.schedule(sampleWorld({ title: 'Kept' }), { art: [sampleArt()] });
    await saver.flush();
    expect(states).toEqual(['full']);
    expect(errors).toHaveLength(1);
    expect(saver.pending()).toBe(true);
    fail = false;
    saver.schedule(sampleWorld({ id: 'w_other', title: 'Other' }));
    await saver.flush();
    expect(commits).toHaveLength(1);
    expect(commits[0].worlds?.map((w) => w.title).sort()).toEqual(['Kept', 'Other']);
    expect(commits[0].art).toHaveLength(1);
    expect(states).toEqual(['full', 'saved']);
    saver.dispose();
  });

  it('says "files-only" in memory mode', async () => {
    const mem = new MemoryStore();
    const saver = createAutosave(mem, { target: new Target(), onState: (s) => states.push(s) });
    saver.schedule(sampleWorld());
    await saver.flush();
    expect(states).toEqual(['files-only']);
    expect((await mem.worlds.list()).map((m) => m.id)).toEqual([sampleWorld().id]);
    saver.dispose();
  });
});
