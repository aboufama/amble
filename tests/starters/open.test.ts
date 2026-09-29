/**
 * Opening starters (§9): the starter world has its example drawings except its "your turn" member and its
 * spares; a seed has only the student's hero drawn; every drawing's blobs come along; a drawing that
 * cannot be fetched plays as just bones; the world is a valid World whose code validates.
 */
import { describe, expect, it } from 'vitest';
import { blobRefOf } from '../../src/model/ids';
import { isWorld } from '../../src/model/guards';
import { createStarterCatalog } from '../../src/starters/api';
import { STARTERS } from '../../src/starters/catalog';

interface NodeFs {
  readFileSync(file: string): Uint8Array;
}
const load = <T>(name: string): Promise<T> => import(/* @vite-ignore */ name) as Promise<T>;
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

async function catalog(o: { failing?: boolean } = {}) {
  const fs = await load<NodeFs>('node:fs');
  const fetched: string[] = [];
  const c = createStarterCatalog({
    level: () => 'middle',
    now: () => 1_700_000_000_000,
    fetchFile: async (path) => {
      fetched.push(path);
      if (o.failing && path.includes('/art/hero/')) throw new Error('offline');
      return new Blob([fs.readFileSync(`${root}/public/${path}`) as Uint8Array<ArrayBuffer>]);
    },
  });
  return { c, fetched };
}

describe('StarterCatalog.open', () => {
  it('opens each starter with its drawings, all but the "your turn" member and the spares', async () => {
    const { c } = await catalog();
    for (const meta of STARTERS.filter((s) => s.id !== 'parade')) {
      const { world, art, blobs } = await c.open(meta.id, { withArt: true });
      expect(isWorld(world), meta.id).toBe(true);
      expect(world.origin).toEqual({ kind: 'starter', starter: meta.id, withArt: true });
      expect(world.code.map((f) => f.path)).toEqual(meta.files.map((f) => f.path));
      expect(Object.keys(world.cast).sort()).toEqual(meta.cast.map((m) => m.key).sort());
      for (const m of meta.cast) {
        const slot = world.cast[m.key];
        if (m.state === 'drawn') {
          const rec = art.find((a) => a.id === slot.art);
          expect(rec?.name, m.key).toBe(m.name);
          expect(rec?.madeBy).toBe('example');
          expect(slot.madeBy).toBe('example');
        } else expect(slot.art, m.key).toBeNull();
      }
      // Every blob a drawing refers to came along (content addresses match).
      const refs = new Set(await Promise.all(blobs.map((b) => blobRefOf(b))));
      for (const rec of art) {
        const exp = rec.export;
        const needed = [rec.doc, ...rec.cels, exp?.flat, exp?.sticker, exp?.thumb, exp?.inkMask, ...Object.values(exp?.parts ?? {}).map((p) => p.blob)].filter(Boolean);
        for (const ref of needed) expect(refs.has(ref as string), `${meta.id}/${rec.name}: ${ref}`).toBe(true);
      }
    }
  });

  it('opens a seed with only the student\'s hero drawn', async () => {
    const { c, fetched } = await catalog();
    const { world, art, blobs } = await c.open('wobble-tower', { withArt: false, hero: 'a_hero000001' });
    expect(world.origin).toEqual({ kind: 'starter', starter: 'wobble-tower', withArt: false });
    expect(world.cast.wobbles).toMatchObject({ art: 'a_hero000001', madeBy: 'student' });
    expect(Object.values(world.cast).filter((s) => s.art)).toHaveLength(1);
    expect(art).toEqual([]);
    expect(blobs).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('keeps the student\'s hero over the example hero', async () => {
    const { c } = await catalog();
    const { world, art } = await c.open('moon-king', { withArt: true, hero: 'a_hero000001' });
    expect(world.cast.hero.art).toBe('a_hero000001');
    expect(art.map((a) => a.name).sort()).toEqual(['Moon sky', 'Star shard', 'The Moon King']);
  });

  it('plays a drawing it cannot fetch as just bones, and still opens', async () => {
    const { c } = await catalog({ failing: true });
    const { world } = await c.open('moon-king', { withArt: true });
    expect(world.cast.hero.art).toBeNull();
    expect(world.cast.moonKing.art).not.toBeNull();
  });

  it('opens the Parade for old imports: its keys, no drawings', async () => {
    const { c } = await catalog();
    const { world } = await c.open('parade', { withArt: false });
    expect(world.origin).toEqual({ kind: 'parade' });
    expect(Object.keys(world.cast)).toEqual(['hero', 'pal1', 'pal2', 'pal3', 'pal4', 'pal5', 'pal6', 'pal7']);
  });

  it('lists the five starters with their words and signs, and gives "Watch it drawn" scripts', async () => {
    const { c } = await catalog();
    const list = c.list();
    expect(list.map((s) => s.id)).toEqual(['moon-king', 'sky-run', 'wobble-tower', 'lantern-maze', 'clanks-climb']);
    for (const s of list) {
      expect(s.title).not.toMatch(/^starters\./);
      expect(s.blurb).not.toMatch(/^starters\./);
      expect(s.sign).toBe(`starters/${s.id}/sign.png`);
      expect(s.hidden).toBe(false);
    }
    expect(c.info('parade').hidden).toBe(true);
    expect((await c.script('moon-king', 'moonKing'))?.name).toBe('moon-king');
    expect(await c.script('moon-king', 'grumble')).toBeNull();
  });
});
