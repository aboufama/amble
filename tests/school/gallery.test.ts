/**
 * The class gallery (§2.14): a card's facts from a student's file (drawings by the student, errors, how it
 * was built), the light read that never decodes pictures and treats every file as untrusted, filters, and
 * the Feedback CSV that can't smuggle formulas into a spreadsheet.
 */
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { packAmble } from '../../src/files/amble';
import type { AmbleManifest, World } from '../../src/model/types';
import { csvCell, toCsv } from '../../src/school/csv';
import { assignmentName, cardFacts, galleryState, initialsFromFileName, matchesFilter, openGallery, resetGallery, type GalleryItem } from '../../src/school/gallery';
import { readForCard } from '../../src/school/galleryRead';
import { buildStory, formatMinutes } from '../../src/school/story';
import { FIXTURE_ART, fixtureWorld, png } from './fixtures';

function manifest(over: Partial<AmbleManifest> = {}): AmbleManifest {
  return { format: 'amble-file', version: 2, kind: 'world', app: 'Amble test', title: 'Moon King', savedAt: '2026-09-15T13:00:00.000Z', madeBy: 'J.R.', assignmentId: null, thumb: 'thumb.png', ...over };
}

async function ambleFile(world: World | null, name = 'Moon King - J.R.amble', over: Partial<AmbleManifest> = {}): Promise<File> {
  const blob = await packAmble({ manifest: manifest(over), world, art: FIXTURE_ART, steps: [], blobs: new Map(), thumb: png() });
  return new File([blob], name, { type: 'application/x-amble' });
}

describe('a card’s facts', () => {
  it('counts the student’s own drawings against what the assignment needs', () => {
    const facts = cardFacts({ world: fixtureWorld(), art: FIXTURE_ART });
    // Needed: the required cast (hero, boss, minion); the minion is the example set's drawing.
    expect(facts).toMatchObject({ drawn: 1, needed: 3, errors: 0 });
    expect(facts?.story).toMatchObject({ sessions: 2, aiChanges: 3, codeEdits: 2, drawings: 1 });
  });

  it('counts the problems the code checker finds', () => {
    const world = fixtureWorld();
    world.code = [...world.code, { path: 'oops.js', source: 'const a = ;', authors: [['student', 1]], locked: [] }];
    expect(cardFacts({ world, art: FIXTURE_ART })?.errors).toBeGreaterThan(0);
  });

  it('has nothing for a file without a world', () => {
    expect(cardFacts({ world: null, art: [] })).toBeNull();
  });
});

describe('how it was built', () => {
  it('splits work into sessions and quotes the student’s requests, newest first', () => {
    const story = buildStory(fixtureWorld(), (id) => FIXTURE_ART.find((a) => a.id === id)?.madeBy ?? null);
    expect(story).toEqual({ sessions: 2, minutes: 35, drawings: 1, aiChanges: 3, codeEdits: 2, requests: ['add a second phase', 'make the boss faster'] });
    expect(formatMinutes(35)).toBe('35 min');
    expect(formatMinutes(72)).toBe('1 h 12 min');
    expect(formatMinutes(120)).toBe('2 h');
  });
});

describe('the light read', () => {
  it('reads the manifest, thumbnail, world and drawing records', async () => {
    const read = await readForCard(await ambleFile(fixtureWorld()));
    expect(read.manifest.madeBy).toBe('J.R.');
    expect(read.world?.title).toBe('Moon King');
    expect(read.world?.code[0].source).toContain('MOON KING');
    expect(read.art.map((a) => a.id)).toEqual(['a_hero000001', 'a_minion0001']);
    expect(read.thumb?.type).toBe('image/png');
  });

  it('refuses what isn’t an Amble file, a newer one, and unsafe entry names', async () => {
    await expect(readForCard(new File(['not a zip'], 'x.amble'))).rejects.toMatchObject({ name: 'FileProblem', kind: 'not-amble' });
    await expect(readForCard(await ambleFile(fixtureWorld(), 'new.amble', { version: 3 as 2 }))).rejects.toMatchObject({ kind: 'newer' });
    const evil = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest())), '../evil.json': strToU8('{}') });
    await expect(readForCard(new Blob([evil as Uint8Array<ArrayBuffer>]))).rejects.toMatchObject({ kind: 'damaged' });
    const noWorld = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest())) });
    await expect(readForCard(new Blob([noWorld as Uint8Array<ArrayBuffer>]))).rejects.toMatchObject({ kind: 'damaged' });
  });

  it('reads a drawing file without a world', async () => {
    const read = await readForCard(await ambleFile(null, 'Pip.amble', { kind: 'drawing' }));
    expect(read.world).toBeNull();
  });
});

describe('opening a folder', () => {
  afterEach(() => resetGallery());

  it('makes a card per file, one per content, and says which files are problems', async () => {
    const a = await ambleFile(fixtureWorld());
    const b = await ambleFile(fixtureWorld({ title: 'Robo vs Goo', credits: { madeBy: 'A.M.' } }), 'Robo vs Goo - A.M.amble', { title: 'Robo vs Goo', madeBy: 'A.M.' });
    const copy = new File([a], 'Moon King - J.R. (1).amble');
    const bad = new File(['nope'], 'Broken - K.L.amble');
    const notes = new File(['hello'], 'notes.txt');
    await openGallery([b, bad, a, copy, notes], 'folder');
    const { items, source, loading } = galleryState();
    expect(source).toBe('folder');
    expect(loading).toBe(false);
    expect(items.map((i) => [i.title, i.madeBy, i.status])).toEqual([
      ['Broken', 'K.L', 'problem'],
      ['Moon King', 'J.R.', 'ready'],
      ['Robo vs Goo', 'A.M.', 'ready'],
    ]);
    expect(items[1]).toMatchObject({ drawn: 1, needed: 3, assignmentTitle: 'Boss Battle Week' });
    expect(assignmentName(items)).toBe('Boss Battle Week');
  });

  it('filters: art done, still just bones, errors, not reviewed', () => {
    const base = { status: 'ready', errors: 0, drawn: 3, needed: 3 } as GalleryItem;
    const bones = { ...base, id: 'b', drawn: 1 } as GalleryItem;
    const broken = { ...base, id: 'e', errors: 2 } as GalleryItem;
    const done = { ...base, id: 'd' } as GalleryItem;
    const notes = { d: { reviewedAt: 1 } };
    expect([done, bones, broken].filter((i) => matchesFilter(i, 'art', notes)).map((i) => i.id)).toEqual(['d', 'e']);
    expect([done, bones, broken].filter((i) => matchesFilter(i, 'bones', notes)).map((i) => i.id)).toEqual(['b']);
    expect([done, bones, broken].filter((i) => matchesFilter(i, 'errors', notes)).map((i) => i.id)).toEqual(['e']);
    expect([done, bones, broken].filter((i) => matchesFilter(i, 'unreviewed', notes)).map((i) => i.id)).toEqual(['b', 'e']);
  });

  it('reads initials from a Hand in file name', () => {
    expect(initialsFromFileName('Moon King - J.R.amble')).toBe('J.R');
    expect(initialsFromFileName('Moon - King - AB.amble')).toBe('AB');
    expect(initialsFromFileName('Untitled.amble')).toBe('Untitled');
  });
});

describe('the Feedback CSV', () => {
  it('quotes what needs quoting', () => {
    expect(csvCell('Moon King')).toBe('Moon King');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(' padded ')).toBe('" padded "');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
    expect(csvCell(true)).toBe('true');
  });

  it('never lets a student’s title run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""click"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
  });

  it('writes CRLF rows with a byte order mark, so spreadsheets read UTF-8', () => {
    expect(toCsv([['Title', 'By'], ['Château', 'É.L.']])).toBe('﻿Title,By\r\nChâteau,É.L.\r\n');
  });
});
