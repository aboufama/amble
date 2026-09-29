/**
 * Validation of `.amble` files (§4.6): oversize files, too many entries, bad paths, SVG art, unknown
 * kinds, newer versions, mismatched hashes and damaged JSON are refused or cut down to what is safe;
 * a partly damaged file opens with what could be read and says so.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { collectWorld, packAmble, readAmble } from '../../src/files/amble';
import { FileProblem } from '../../src/files/problem';
import { checkBlob, cleanWorld, entryName, fitAuthors, pngSize, sniff } from '../../src/files/validate';
import { sha256Hex } from '../../src/model/ids';
import { LIMITS } from '../../src/model/limits';
import { MemoryStore } from '../../src/store/memory';
import { sampleWorld } from '../foundation/samples';
import { png, seedWorld } from './fixtures';

type Entries = Record<string, Uint8Array>;

async function seededEntries(): Promise<Entries> {
  const store = new MemoryStore();
  const seed = await seedWorld(store);
  const file = await packAmble(await collectWorld(store, seed.world, 'world'));
  return unzipSync(new Uint8Array(await file.arrayBuffer()));
}

function zip(entries: Entries | Zippable): Blob {
  return new Blob([zipSync(entries as Zippable)]);
}

async function problem(p: Promise<unknown>): Promise<FileProblem> {
  try {
    await p;
  } catch (err) {
    if (err instanceof FileProblem) return err;
    throw err;
  }
  throw new Error('It opened.');
}

const json = (v: unknown) => strToU8(JSON.stringify(v));

describe('refused files', () => {
  it('refuses a file over 60 MB before reading it, with its size', async () => {
    const big = new Blob([new Uint8Array(LIMITS.ambleFileBytes + 2 * 1024 * 1024)]);
    const p = await problem(readAmble(big));
    expect(p.kind).toBe('too-big');
    expect(p.message).toBe('This world is 62 MB, which is too big to open here.');
  });

  it('refuses more than 2,000 entries', async () => {
    const entries: Entries = { 'manifest.json': json({ format: 'amble-file', version: 2, kind: 'world' }) };
    for (let i = 0; i < 2001; i++) entries[`x/${i}.txt`] = new Uint8Array([1]);
    expect((await problem(readAmble(zip(entries)))).kind).toBe('damaged');
  });

  it('refuses unsafe entry names', async () => {
    const good = await seededEntries();
    for (const bad of ['../evil.json', '/etc/passwd', 'art\\..\\x.json', 'C:/x.json', 'steps/./s.json']) {
      const p = await problem(readAmble(zip({ ...good, [bad]: json({}) })));
      expect(p.kind).toBe('damaged');
    }
    expect(entryName('blobs/' + 'a'.repeat(64) + '.png').kind).toBe('blob');
    expect(entryName('blobs/' + 'a'.repeat(64) + '.svg').kind).toBe('unknown');
    expect(entryName('art/a_x.json')).toEqual({ kind: 'art', id: 'a_x' });
  });

  it('refuses what is not an Amble file, an unknown kind, and says when a file is newer', async () => {
    expect((await problem(readAmble(new Blob(['hello'])))).kind).toBe('not-amble');
    expect((await problem(readAmble(zip({ 'readme.txt': strToU8('hi') })))).kind).toBe('not-amble');
    const good = await seededEntries();
    const manifest = JSON.parse(new TextDecoder().decode(good['manifest.json'])) as Record<string, unknown>;
    expect((await problem(readAmble(zip({ ...good, 'manifest.json': json({ ...manifest, kind: 'movie' }) })))).kind).toBe('not-amble');
    expect((await problem(readAmble(zip({ ...good, 'manifest.json': json({ ...manifest, format: 'scratch' }) })))).kind).toBe('not-amble');
    const newer = await problem(readAmble(zip({ ...good, 'manifest.json': json({ ...manifest, version: 3 }) })));
    expect(newer.kind).toBe('newer');
    expect(newer.message).toBe('This world was made with a newer Amble. Reload Amble to get the update.');
  });

  it('refuses a world that is not a world', async () => {
    const good = await seededEntries();
    const world = JSON.parse(new TextDecoder().decode(good['world.json'])) as Record<string, unknown>;
    const noGame = { ...world, code: [{ path: 'boss.js', source: 'x', authors: [], locked: [] }] };
    expect((await problem(readAmble(zip({ ...good, 'world.json': json(noGame) })))).kind).toBe('damaged');
    expect((await problem(readAmble(zip({ ...good, 'world.json': strToU8('{not json') })))).kind).toBe('damaged');
  });
});

describe('partly damaged files', () => {
  it('drops a drawing whose picture is SVG, and says how many opened', async () => {
    const good = await seededEntries();
    const art = JSON.parse(new TextDecoder().decode(good['art/a_king000001.json'])) as { export: { flat: string } };
    const svg = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const hex = await sha256Hex(svg);
    const tampered: Entries = { ...good, [`blobs/${hex}.png`]: svg, 'art/a_king000001.json': json({ ...art, export: { ...art.export, flat: `sha256:${hex}` } }) };
    const f = await readAmble(zip(tampered));
    expect(f.art.map((a) => a.id)).toEqual(['a_hero000001']);
    expect(f.world?.cast.moonKing.art).toBeNull();
    expect(f.warnings).toEqual(['This file is damaged. Amble opened what it could: 1 of 2 drawings.']);
    expect([...f.blobs.keys()]).not.toContain(`sha256:${hex}`);
  });

  it('drops a blob whose bytes do not match its name, and the drawing that needs it', async () => {
    const good = await seededEntries();
    const art = JSON.parse(new TextDecoder().decode(good['art/a_hero000001.json'])) as { export: { flat: string } };
    const name = `blobs/${art.export.flat.slice(7)}.png`;
    const swapped: Entries = { ...good, [name]: new Uint8Array(await png(12345).arrayBuffer()) };
    const f = await readAmble(zip(swapped));
    expect(f.art.map((a) => a.id)).toEqual(['a_king000001']);
    expect(f.warnings[0]).toBe('This file is damaged. Amble opened what it could: 1 of 2 drawings.');
  });

  it('drops unknown fields, caps strings and mends provenance', () => {
    const w = sampleWorld({ title: 'x'.repeat(90) });
    const dirty = { ...w, secretField: 'nope', code: [{ ...w.code[0], authors: [['ai', 99]], extra: 1 }], cast: { ...w.cast, hero: { ...w.cast.hero, key: 'wrong' } } };
    const clean = cleanWorld(dirty)!;
    expect(clean).not.toHaveProperty('secretField');
    expect(clean.code[0]).not.toHaveProperty('extra');
    expect(clean.title).toHaveLength(40);
    expect(clean.code[0].authors).toEqual([['ai', 4]]);
    expect(clean.cast.hero.key).toBe('hero');
    expect(fitAuthors([['starter', 2]], 5)).toEqual([['starter', 5]]);
    expect(fitAuthors([], 3)).toEqual([['student', 3]]);
  });

  it('knows real pictures and sounds by their first bytes', async () => {
    const p = new Uint8Array(await png(1).arrayBuffer());
    expect(sniff(p)).toBe('png');
    expect(pngSize(p)).toEqual({ w: 1, h: 1 });
    expect(sniff(strToU8('  <svg>'))).toBe('svg');
    expect(sniff(strToU8('<?xml version="1.0"?><svg/>'))).toBe('svg');
    expect(checkBlob('png', strToU8('<svg/>'))).toEqual({ ok: false, reason: 'svg' });
    const huge = p.slice();
    new DataView(huge.buffer).setUint32(16, 4096);
    expect(checkBlob('png', huge)).toEqual({ ok: false, reason: 'png size' });
    expect(checkBlob('json', strToU8('{"a":1}'))).toEqual({ ok: true });
    expect(checkBlob('json', strToU8('{"a":'))).toEqual({ ok: false, reason: 'json' });
  });
});
