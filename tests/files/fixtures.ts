/**
 * A consistent world in a store for M6's tests: two drawings with real (tiny) PNG blobs, their ArtDoc
 * JSON, a recorded sound, two footsteps (one holding an older version of the hero), a Trail snapshot,
 * plus things that must never reach a file: a draft, a stroke log and a class code in the settings.
 */
import { templateFor } from '../../src/cores/rig';
import { encodeWav } from '../../src/files/media';
import { blobRefOf, hexOfRef } from '../../src/model/ids';
import type { ArtRecord, BlobRef, StepSnapshot, World } from '../../src/model/types';
import type { Store } from '../../src/store/api';
import { sampleArt, sampleClassLink, sampleWorld } from '../foundation/samples';

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A valid PNG (1x1), made unique by bytes after its end. */
export function png(tag: number): Blob {
  const base = Uint8Array.from(atob(PNG_1x1), (c) => c.charCodeAt(0));
  const out = new Uint8Array(base.length + 4);
  out.set(base);
  new DataView(out.buffer).setUint32(base.length, tag);
  return new Blob([out], { type: 'image/png' });
}

export function wav(samples = 32): Blob {
  const pcm = new Float32Array(samples).map((_, i) => Math.sin(i / 3) * 0.5);
  return new Blob([encodeWav(pcm, 22050) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}

export function docBlob(celRefs: BlobRef[], name = 'Blorp'): Blob {
  const json = {
    format: 'amble-art',
    v: 1,
    id: 'art1',
    name,
    kind: 'character',
    width: 1,
    height: 1,
    pixelArt: false,
    layers: [{ id: 'lines', name: 'Lines', role: 'lines', visible: true, locked: false, opacity: 1, blend: 'normal', alphaLock: false }],
    frames: [{ id: 'f1', hold: 1 }],
    cels: celRefs.map((ref) => ({ frame: 'f1', layer: 'lines', x: 0, y: 0, w: 1, h: 1, ref })),
    anchor: null,
    palette: [],
    created: 1,
    updated: 1,
    version: 1,
  };
  return new Blob([JSON.stringify(json)], { type: 'application/json' });
}

export interface Seeded {
  world: World;
  art: ArtRecord[];
  steps: StepSnapshot[];
  blobs: Map<BlobRef, Blob>;
  snapshot: BlobRef;
  /** Bytes that must never appear in a file. */
  secrets: { stroke: Uint8Array; draftCel: Blob; classCode: string };
}

async function drawing(id: string, name: string, tag: number, blobs: Map<BlobRef, Blob>): Promise<ArtRecord> {
  const add = async (b: Blob) => {
    const ref = await blobRefOf(b);
    blobs.set(ref, b);
    return ref;
  };
  const cel = await add(png(tag));
  const doc = await add(docBlob([cel], name));
  const flat = await add(png(tag + 1));
  const sticker = await add(png(tag + 2));
  const thumb = await add(png(tag + 3));
  const part = await add(png(tag + 4));
  return sampleArt({
    id,
    name,
    doc,
    cels: [cel],
    export: { hash: hexOfRef(flat), flat, w: 1, h: 1, anchor: [0.5, 1], inkMask: null, parts: { 'part:head': { blob: part, x: 0, y: 0, w: 1, h: 1 } }, sticker, thumb, frames: null },
    rigData: { ...templateFor('biped', 1, 1), artHash: hexOfRef(flat) },
  });
}

export async function seedWorld(store: Store): Promise<Seeded> {
  const blobs = new Map<BlobRef, Blob>();
  const hero = await drawing('a_hero000001', 'Blorp', 100, blobs);
  const king = await drawing('a_king000001', 'Moon King', 200, blobs);
  const oldHero = await drawing('a_hero000001', 'Blorp', 300, blobs);
  const recording = wav();
  const recRef = await blobRefOf(recording);
  blobs.set(recRef, recording);
  const shot = png(900);
  const snapshot = await blobRefOf(shot);

  const base = sampleWorld();
  const world: World = {
    ...base,
    cast: {
      hero: { key: 'hero', art: hero.id, madeBy: 'student', extra: null, laterUntil: 0 },
      moonKing: { key: 'moonKing', art: king.id, madeBy: 'student', extra: null, laterUntil: 0 },
      grumble: { key: 'grumble', art: null, madeBy: null, extra: null, laterUntil: 0 },
    },
    sounds: {
      roar: { name: 'roar', source: { kind: 'recording', blob: recRef, mime: 'audio/wav', duration: 0.1 }, effects: ['louder'], caption: '[boss roars]', madeBy: 'student' },
      coin: { name: 'coin', source: { kind: 'preset', preset: 'coin', variation: 2 }, effects: [], caption: '[coin]', madeBy: 'student' },
    },
    steps: [
      { id: 's_start00001', at: 1_700_000_000_000, by: 'student', kind: 'start', text: 'You started Moon King.' },
      { id: 's_draw000001', at: 1_700_000_050_000, by: 'student', kind: 'draw', text: 'You drew Blorp.', cast: 'hero' },
    ],
    head: 's_draw000001',
  };
  const stepArt = (a: ArtRecord) => ({ version: a.version, doc: a.doc, cels: a.cels, export: a.export, rigData: a.rigData });
  const steps: StepSnapshot[] = [
    { id: 's_start00001', worldId: world.id, code: world.code, cast: { ...world.cast, hero: { ...world.cast.hero, art: null, madeBy: null } }, art: { [king.id]: stepArt(king) }, sounds: {}, dials: {}, twists: [] },
    { id: 's_draw000001', worldId: world.id, code: world.code, cast: world.cast, art: { [hero.id]: stepArt(oldHero), [king.id]: stepArt(king) }, sounds: world.sounds, dials: world.dials, twists: world.twists },
  ];
  await store.commit({ blobs: [...blobs.values(), shot], art: [hero, king], worlds: [world], steps, snapshots: { [world.id]: snapshot } });
  blobs.set(snapshot, shot);

  const stroke = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x51, 0x7e]);
  await store.strokes.append(hero.id, stroke);
  const draftCel = new Blob([new Uint8Array([0xca, 0xfe, 0xf0, 0x0d, 0x77])], { type: 'image/png' });
  await store.drafts.put({ artId: hero.id, worldId: world.id, castKey: 'hero', doc: '{"layers":[]}', cels: { lines: draftCel }, tool: 'ink', at: Date.now() });
  const classCode = 'SECRET-CLASS-9931';
  await store.settings.put('classLink', sampleClassLink({ ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'class-code', header: 'X-Amble-Class', code: classCode } } }));
  return { world, art: [hero, king], steps, blobs, snapshot, secrets: { stroke, draftCel, classCode } };
}

/** Base64 of bytes (small ones: data URLs in tests). */
export function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Whether `needle` occurs anywhere in `hay`. */
export function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
