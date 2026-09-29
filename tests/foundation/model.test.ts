/**
 * The model (§4.2, §4.8): every guard accepts its valid shape and rejects broken or random input, and the
 * budgets in limits.ts match the spec.
 */
import { describe, expect, it } from 'vitest';
import * as G from '../../src/model/guards';
import { KEEP, LIMITS, TEXT_LIMITS } from '../../src/model/limits';
import { deriveMeta } from '../../src/store/meta';
import { REF_A, sampleArt, sampleAssignment, sampleClassLink, sampleDraft, sampleLog, samplePlan, samplePrefs, sampleStep, sampleWorld } from './samples';

type Case = { name: string; guard: (v: unknown) => boolean; sample: () => Record<string, unknown>; optional?: string[] };

const CASES: Case[] = [
  { name: 'World', guard: G.isWorld, sample: () => ({ ...sampleWorld() }) },
  { name: 'WorldMeta', guard: G.isWorldMeta, sample: () => ({ ...deriveMeta(sampleWorld(), null, { art: () => sampleArt() }) }) },
  { name: 'ArtRecord', guard: G.isArtRecord, sample: () => ({ ...sampleArt() }) },
  { name: 'StepSnapshot', guard: G.isStepSnapshot, sample: () => ({ ...sampleStep() }) },
  { name: 'StepSummary', guard: G.isStepSummary, sample: () => ({ ...sampleWorld().steps[0], request: 'make it floaty', files: ['game.js'], lines: 3 }), optional: ['request', 'files', 'cast', 'lines', 'tested', 'handEdits'] },
  { name: 'PlanReply', guard: G.isPlanReply, sample: () => ({ ...samplePlan() }) },
  { name: 'Assignment', guard: G.isAssignment, sample: () => ({ ...sampleAssignment() }) },
  { name: 'ClassLinkV1', guard: G.isClassLinkV1, sample: () => ({ ...sampleClassLink() }) },
  { name: 'AiLogEntry', guard: G.isAiLogEntry, sample: () => ({ ...sampleLog() }) },
  { name: 'DeskDraft', guard: G.isDeskDraft, sample: () => ({ ...sampleDraft() }) },
  { name: 'Prefs', guard: G.isPrefs, sample: () => ({ ...samplePrefs() }) },
  {
    name: 'AmbleManifest',
    guard: G.isAmbleManifest,
    sample: () => ({ format: 'amble-file', version: 2, kind: 'world', app: 'Amble 0.1.0', title: 'Moon King', savedAt: '2026-09-29T10:00:00Z', madeBy: 'AB', assignmentId: null, thumb: 'thumb.png' }),
  },
  {
    name: 'StarterInfo',
    guard: G.isStarterInfo,
    sample: () => ({ id: 'moon-king', title: 'Moon King', genre: 'Boss fight', blurb: 'Beat a giant boss.', teaches: 'state machines', sign: '', heroKey: 'hero', yourTurn: 'grumble', spare: ['bubbles'], tags: ['boss'], hidden: false }),
  },
  { name: 'HandInState', guard: G.isHandInState, sample: () => ({ fileName: 'moon-king.amble', savedAt: 1, method: 'download', turnedInAt: null }) },
  { name: 'CheckResult', guard: G.isCheckResult, sample: () => ({ goal: 'g1', pass: true, evidence: '3 found in your code' }) },
  { name: 'ExplainReply', guard: G.isExplainReply, sample: () => ({ answer: 'This line makes the boss jump.', lines: [{ from: 3, to: 4, note: 'the jump' }], safetyNote: '' }) },
];

/** A value no field of any §4.2 shape accepts. */
const POISON = Symbol('not a value');

/** Deterministic random JSON-ish values. */
function randomValue(seed: number, depth = 0): unknown {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const pick = Math.floor(rnd() * (depth > 2 ? 5 : 7));
  switch (pick) {
    case 0:
      return null;
    case 1:
      return rnd() * 1e6 - 5e5;
    case 2:
      return rnd() < 0.5;
    case 3:
      return 'x'.repeat(Math.floor(rnd() * 12));
    case 4:
      return undefined;
    case 5:
      return Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => randomValue(seed * 31 + i, depth + 1));
    default: {
      const o: Record<string, unknown> = {};
      const keys = ['id', 'title', 'kind', 'format', 'version', 'cast', 'code', 'v', 'status', 'name'];
      for (let i = 0; i < 4; i++) o[keys[Math.floor(rnd() * keys.length)]] = randomValue(seed * 17 + i, depth + 1);
      return o;
    }
  }
}

describe('model guards', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it('accepts the valid shape', () => {
        expect(c.guard(c.sample())).toBe(true);
      });

      it('rejects a missing required field', () => {
        const sample = c.sample();
        const failures = Object.keys(sample)
          .filter((k) => !c.optional?.includes(k))
          .filter((k) => {
            const broken = { ...sample };
            delete broken[k];
            return c.guard(broken);
          });
        expect(failures).toEqual([]);
      });

      it('rejects a field of the wrong type', () => {
        const sample = c.sample();
        const failures = Object.keys(sample).filter((k) => c.guard({ ...sample, [k]: POISON }));
        expect(failures).toEqual([]);
      });

      it('rejects random input', () => {
        for (let seed = 1; seed <= 200; seed++) expect(c.guard(randomValue(seed))).toBe(false);
        for (const v of [null, undefined, 0, '', [], {}, 'amble', true]) expect(c.guard(v)).toBe(false);
      });
    });
  }

  it('checks nested fields and formats', () => {
    const w = sampleWorld();
    expect(G.isWorld({ ...w, code: [{ ...w.code[0], path: 'Game.JS' }] })).toBe(false);
    expect(G.isWorld({ ...w, cast: { 'Bad Key': w.cast.hero } })).toBe(false);
    expect(G.isWorld({ ...w, title: 'x'.repeat(41) })).toBe(false);
    expect(G.isWorld({ ...w, code: Array.from({ length: 9 }, (_, i) => ({ ...w.code[0], path: `f${i}.js` })) })).toBe(false);
    expect(G.isWorld({ ...w, origin: { kind: 'starter', starter: 'nope', withArt: true } })).toBe(false);
    expect(G.isArtRecord({ ...sampleArt(), doc: 'sha256:xyz' })).toBe(false);
    expect(G.isArtRecord({ ...sampleArt(), board: { w: 4096, h: 10, pixelArt: false } })).toBe(false);
    expect(G.isClassLinkV1({ ...sampleClassLink(), ai: { baseUrl: 'https://ai.test/v1', model: 'm', auth: { type: 'key', key: 'sk-1' } } })).toBe(false);
    expect(G.isLineRange([3, 2])).toBe(false);
    expect(G.isLineRange([2, 3])).toBe(true);
    expect(G.isBlobRefGuard(REF_A)).toBe(true);
  });

  it('merges stored prefs over the defaults, dropping invalid fields', () => {
    const base = samplePrefs();
    const merged = G.mergeValid(base, { theme: 'day', textScale: 7, uiSounds: 'loud', unknown: 1 }, G.PREFS_FIELDS);
    expect(merged.theme).toBe('day');
    expect(merged.textScale).toBe(base.textScale);
    expect(merged.uiSounds).toBe(base.uiSounds);
    expect('unknown' in merged).toBe(false);
  });

  it('has one guard per settings key', () => {
    expect(Object.keys(G.SETTINGS_GUARDS).sort()).toEqual(['classLink', 'consent', 'lastRoute', 'legacy', 'manualAi', 'noVision', 'prefs', 'teacher']);
    expect(G.SETTINGS_GUARDS.prefs(samplePrefs())).toBe(true);
    expect(G.SETTINGS_GUARDS.classLink(sampleClassLink())).toBe(true);
    expect(G.SETTINGS_GUARDS.lastRoute('#/trail')).toBe(true);
  });
});

describe('limits (§4.8)', () => {
  const KB = 1024;
  const MB = 1024 * KB;
  it('matches the budgets table', () => {
    expect(LIMITS).toMatchObject({
      worldJsonBytes: 200 * KB,
      codeFiles: 8,
      codeFileLines: 400,
      codeFileBytes: 40 * KB,
      codeTotalBytes: 120 * KB,
      castKeys: 16,
      dials: 8,
      sounds: 32,
      worldBlobsWarnBytes: 40 * MB,
      worldBlobsRefuseBytes: 60 * MB,
      boardMaxSide: 2048,
      backgroundWidth: 1920,
      backgroundHeight: 1080,
      layers: 12,
      layersOnTheBones: 16,
      frames: 24,
      deskMemoryBytes: 250 * MB,
      deskLayerBytesPer1024: 4 * MB,
      deskUndoBytes: 128 * MB,
      gameTextureBytes: 32 * MB,
      ambleFileBytes: 60 * MB,
      storageWarnRatio: 0.8,
    });
  });

  it('matches the §4.2 length limits and what is kept', () => {
    expect(TEXT_LIMITS).toMatchObject({ worldTitle: 40, worldPitch: 300, madeBy: 20, assignmentTitle: 60, assignmentText: 400, planTitle: 28, planPitch: 140, palette: 24, castKey: 24 });
    expect(KEEP).toMatchObject({ gameStorageBytes: 64 * KB, stepsPerWorld: 60, aiLogEntries: 50, lostAndFoundDays: 30 });
  });
});
