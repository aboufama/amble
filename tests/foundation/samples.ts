/**
 * Valid samples of the §4.2 shapes, for FOUNDATION's tests (and any module's: import freely).
 * Every builder returns a fresh object; pass overrides for the fields a test cares about.
 */
import { templateFor } from '../../src/cores/rig';
import type {
  AiLogEntry,
  ArtRecord,
  Assignment,
  BlobRef,
  ClassLinkV1,
  DeskDraft,
  PlanReply,
  StepSnapshot,
  World,
} from '../../src/model/types';
import { defaultPrefs } from '../../src/state/prefs';

export const REF_A = `sha256:${'a'.repeat(64)}` as BlobRef;
export const REF_B = `sha256:${'b'.repeat(64)}` as BlobRef;
export const REF_C = `sha256:${'c'.repeat(64)}` as BlobRef;

export const SAMPLE_CODE = [
  'export default class Game extends Kit.Game {',
  '  static art = { hero: { role: "hero", kind: "character", rig: "biped" } };',
  '  create() { this.spawn(100, 300, "hero"); }',
  '}',
].join('\n');

export function sampleWorld(over: Partial<World> = {}): World {
  return {
    format: 'amble-world',
    version: 1,
    id: 'w_sample0001',
    title: 'Moon King',
    pitch: '',
    level: 'middle',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    openedAt: 1_700_000_100_000,
    origin: { kind: 'starter', starter: 'moon-king', withArt: false },
    code: [{ path: 'game.js', source: SAMPLE_CODE, authors: [['starter', 4]], locked: [] }],
    cast: {
      hero: { key: 'hero', art: 'a_hero000001', madeBy: 'student', extra: null, laterUntil: 0 },
      moonKing: { key: 'moonKing', art: null, madeBy: null, extra: null, laterUntil: 0 },
      pal: { key: 'pal', art: null, madeBy: null, extra: { name: 'Pal', role: 'npc', kind: 'character', rig: 'biped', note: '' }, laterUntil: 0 },
    },
    sounds: {
      roar: { name: 'roar', source: { kind: 'preset', preset: 'roar', variation: 1 }, effects: [], caption: '[boss roars]', madeBy: 'student' },
    },
    dials: { jump: 820 },
    twists: ['moonGravity'],
    controls: { jump: ['Space', 'ArrowUp'] },
    gameStorage: { best: '120' },
    steps: [{ id: 's_start00001', at: 1_700_000_000_000, by: 'student', kind: 'start', text: 'You started Moon King.' }],
    head: 's_start00001',
    assignment: null,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
    credits: { madeBy: '' },
    plan: null,
    ...over,
  };
}

export function sampleArt(over: Partial<ArtRecord> = {}): ArtRecord {
  return {
    id: 'a_hero000001',
    name: 'Blorp',
    kind: 'character',
    rig: 'biped',
    facing: 'right',
    role: 'hero',
    mode: 'free',
    board: { w: 1024, h: 1024, pixelArt: false },
    doc: REF_A,
    cels: [REF_B],
    parts: {},
    export: {
      hash: 'f'.repeat(64),
      flat: REF_B,
      w: 300,
      h: 420,
      anchor: [150, 410],
      inkMask: null,
      parts: {},
      sticker: REF_C,
      thumb: REF_C,
      frames: null,
    },
    rigData: templateFor('biped', 300, 420),
    rigInfo: { made: 'auto', confidence: 0.8, notes: [] },
    palette: ['#221b2e', '#ffc15e'],
    madeBy: 'student',
    shelf: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    version: 1,
    ...over,
  };
}

export function sampleStep(world: World = sampleWorld(), over: Partial<StepSnapshot> = {}): StepSnapshot {
  return {
    id: world.head,
    worldId: world.id,
    code: world.code,
    cast: world.cast,
    art: { a_hero000001: { version: 1, doc: REF_A, cels: [REF_B], export: null, rigData: null } },
    sounds: world.sounds,
    dials: world.dials,
    twists: world.twists,
    ...over,
  };
}

export function samplePlan(over: Partial<PlanReply> = {}): PlanReply {
  return {
    status: 'ok',
    safetyNote: '',
    title: 'Snail Rescue',
    pitch: 'Help a brave snail rescue its friends from a salty king.',
    starter: 'moon-king',
    twist: { name: 'Slow-mo', does: 'Everything moves at snail speed.' },
    controls: [
      { keys: '← →', does: 'crawl' },
      { keys: 'Space', does: 'jump' },
    ],
    cast: [
      { key: 'hero', name: 'Shelly', ask: 'Draw Shelly, a brave snail', about: 'Your hero. Gets bones: walks, jumps, cheers.', role: 'hero', kind: 'character', rig: 'blob', facing: 'right', pronoun: 'her', size: 'hero', required: true, mapsTo: 'hero' },
      { key: 'saltKing', name: 'Salt King', ask: 'Draw the Salt King', about: 'The boss. Throws salt.', role: 'boss', kind: 'character', rig: 'biped', facing: 'left', pronoun: 'him', size: 'huge', required: true, mapsTo: 'moonKing' },
    ],
    builds: ['A boss fight in three phases', 'Salt that slows you down'],
    dials: [
      { key: 'jump', label: 'Jump height' },
      { key: 'bossHp', label: 'Boss health' },
      { key: 'saltSpeed', label: 'Salt speed' },
    ],
    ...over,
  };
}

export function sampleAssignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'g_boss000001',
    title: 'Boss Battle Week',
    text: 'Make a boss fight. Draw your own hero and a giant boss.',
    starter: 'moon-king',
    require: ['hero', 'moonKing'],
    goals: [
      { id: 'g1', label: 'Draw your hero', kind: 'auto', check: { type: 'drawn', key: 'hero' } },
      { id: 'g2', label: 'Tell a friend', kind: 'teacher' },
    ],
    ai: 'on',
    level: null,
    due: 'Friday',
    locked: {},
    ...over,
  };
}

export function sampleClassLink(over: Partial<ClassLinkV1> = {}): ClassLinkV1 {
  return {
    v: 1,
    cls: 'Room 12',
    district: 'SAU 99',
    ai: { baseUrl: 'https://ai.test/v1', model: 'test-model', auth: { type: 'class-code', header: 'X-Amble-Class', code: 'TEST-1234' } },
    mode: 'on',
    level: 'middle',
    exp: null,
    asg: null,
    ...over,
  };
}

export function sampleLog(over: Partial<AiLogEntry> = {}): AiLogEntry {
  return {
    id: 'l_000000001',
    at: 1_700_000_000_000,
    kind: 'change',
    host: 'ai.test',
    model: 'test-model',
    bytesSent: 1200,
    bytesReceived: 800,
    included: ['your words', 'game.js (4 lines)'],
    body: '{"model":"test-model"}',
    status: 'ok',
    replySummary: 'Changed the jump.',
    ...over,
  };
}

export function sampleDraft(over: Partial<DeskDraft> = {}): DeskDraft {
  return {
    artId: 'a_hero000001',
    worldId: 'w_sample0001',
    castKey: 'hero',
    doc: '{"layers":[]}',
    cels: { l1: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) },
    tool: 'ink',
    at: 1_700_000_000_000,
    ...over,
  };
}

export const samplePrefs = () => defaultPrefs(false);
