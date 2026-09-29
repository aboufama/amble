/**
 * Auto-rigging from the drawing itself, with no AI: analyse the shape, fit the template of the kind the
 * art request asked for (never a guess), add extras, and return `RigData` in art pixels.
 *
 * The working grid adapts: 150 px first; 240 px when the fit is missing limbs it should have, legs
 * merged, or the strokes are thinner than 2 working px (legs drawn close together only separate at
 * the larger size).
 */
import { analyze, toArtX, toArtY, type Analysis } from './analyze';
import { DEFAULT_SPRING } from './format';
import { fitBiped } from './fit/biped';
import { fitBlob } from './fit/blob';
import type { Fit, FitIssue } from './fit/common';
import { fitFlyer } from './fit/flyer';
import { makeGuide, type Guide, type Hints } from './fit/guide';
import { fitObject } from './fit/object';
import { fitQuadruped } from './fit/quadruped';
import { fitSwimmer } from './fit/swimmer';
import { addExtras } from './fit/extras';
import { hashPixels } from './hash';
import { partsFromLayers } from './parts';
import type { CharacterKind, Facing, JointHints, RigBone, RigData, RigInput } from './types';

export interface AutoRigOptions {
  /** Joint hints (where bones start, art px) from the Draw room's guide pose or a vision model. */
  hints?: JointHints;
  /** Where leaf bones end (hands, feet, head top, tail and wing tips), art px. */
  tipHints?: JointHints;
  /**
   * A limb whose hints don't snap to the drawing is left out ('drop', for vision hints) or kept where
   * the hints put it ('keep', for a guide pose or the student's own joints). Default 'drop'.
   */
  unsnapped?: 'drop' | 'keep';
  /** Which way the drawing looks, when the art request says so (bipeds and swimmers can't tell). */
  facing?: Facing;
  /** Fixed working size in px (skips the adaptive retry). */
  workSize?: number;
  /** Authorship recorded in the rig (default 'auto'). */
  made?: RigData['made'];
  /** Supplies analyses (a cache): same pixels and working size must give the same analysis. */
  analyze?: (workSize: number) => Analysis;
}

/** What rigging a drawing tells the app. */
export interface RigResult {
  rig: RigData;
  /** Kid-readable notes for the Bones view ("Amble's guess"). */
  notes: string[];
  /** Stable codes for what went wrong, for the UI's own words. */
  issues: FitIssue[];
  /**
   * 0..1: lowered when a limb is missing, legs were stuck together or hints were dropped. Below 0.6
   * the Desk offers "Check the bones?".
   */
  confidence: number;
}

export interface AutoRigResult extends RigResult {
  analysis: Analysis;
  workSize: number;
  ms: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Issues that a larger working size can fix, weighted. */
const RETRY_WEIGHT: Partial<Record<FitIssue, number>> = {
  'no-legs': 3, 'one-leg': 3, 'legs-merged': 2, 'few-legs': 2, 'missing-arm': 1, 'no-arms': 1, 'missing-wing': 1, 'no-head': 2,
};

/** How much each issue costs in confidence. */
const PENALTY: Partial<Record<FitIssue, number>> = {
  'no-legs': 0.5, 'one-leg': 0.45, 'legs-merged': 0.45, 'few-legs': 0.4, 'no-head': 0.4, 'missing-arm': 0.45, 'no-arms': 0.45,
  'missing-wing': 0.45, 'hint-dropped': 0.3, 'short-body': 0.3, 'no-tail': 0.05,
};

export function confidenceOf(issues: readonly FitIssue[]): number {
  let c = 1;
  for (const i of new Set(issues)) c -= PENALTY[i] ?? 0.1;
  return Math.max(0, Math.round(c * 100) / 100);
}

function fitKind(a: Analysis, kind: CharacterKind, guide: Guide | null, facing: Facing | undefined): Fit {
  switch (kind) {
    case 'biped': {
      const f = fitBiped(a, guide);
      addExtras(a, f);
      return f;
    }
    case 'quadruped': {
      const f = fitQuadruped(a, guide);
      addExtras(a, f);
      return f;
    }
    case 'flyer':
      return fitFlyer(a, guide, facing);
    case 'swimmer':
      return fitSwimmer(a, guide, facing ?? 0);
    case 'blob':
      return fitBlob(a);
    case 'object':
      return fitObject(a);
  }
}

function score(fit: Fit, a: Analysis): number {
  let s = 0;
  for (const i of fit.issues) s += RETRY_WEIGHT[i] ?? 0;
  // outlines under ~2 working px break up: colour floods leak and pins drift
  if (a.strokeW > 0 && a.strokeW <= 2.2) s += 1;
  return s;
}

export function autoRig(input: RigInput, kind: CharacterKind, opts: AutoRigOptions = {}): AutoRigResult {
  const t0 = performance.now();
  const img = input.image;
  const longest = Math.max(img.width, img.height);
  const hints: Hints | null = opts.hints || opts.tipHints ? { joints: opts.hints, tips: opts.tipHints } : null;
  const run = (workSize: number) => {
    const a = opts.analyze ? opts.analyze(workSize) : analyze(input, { workSize });
    const guide = hints ? makeGuide(a, kind, hints, opts.unsnapped === 'keep') : null;
    const fit = fitKind(a, kind, guide, opts.facing);
    if (guide && guide.unsnapped.size && opts.unsnapped !== 'keep') {
      fit.issues.push('hint-dropped');
      fit.notes.push('Some of the helper\'s joints didn\'t match the drawing, so I placed those limbs myself.');
    }
    return { a, fit, workSize };
  };
  let best = run(opts.workSize ?? 150);
  if (!opts.workSize && longest > 170 && (score(best.fit, best.a) > 0 || best.fit.retry)) {
    const big = run(240);
    if (score(big.fit, big.a) <= score(best.fit, best.a)) best = big;
  }
  const { a, fit } = best;
  const rig = rigFromFit(a, fit, kind, opts, hashPixels(img));
  if (input.layers) {
    const parts = partsFromLayers(rig, input.layers);
    if (parts.length) rig.parts = parts;
  }
  const issues = [...new Set(fit.issues)];
  return {
    rig,
    analysis: a,
    notes: fit.notes,
    issues,
    confidence: confidenceOf(issues),
    workSize: best.workSize,
    ms: performance.now() - t0,
  };
}

export function rigFromFit(a: Analysis, fit: Fit, kind: CharacterKind, opts: AutoRigOptions, artHash: string): RigData {
  const index = new Map<string, number>();
  const bones: RigBone[] = [];
  for (const b of fit.bones) {
    const bone: RigBone = {
      name: b.name,
      role: b.role,
      parent: b.parent ? index.get(b.parent) ?? -1 : -1,
      x: round2(toArtX(a, b.a[0])),
      y: round2(toArtY(a, b.a[1])),
      x2: round2(toArtX(a, b.b[0])),
      y2: round2(toArtY(a, b.b[1])),
    };
    if (bone.x === bone.x2 && bone.y === bone.y2) bone.y2 = round2(bone.y2 - 1);
    if (b.dynamic) bone.dynamic = { ...DEFAULT_SPRING };
    if (b.rigid) bone.rigid = true;
    index.set(b.name, bones.length);
    bones.push(bone);
  }
  // bipeds and things can't tell which way they look; the art request can
  const facing: Facing = kind === 'biped' || kind === 'object' ? opts.facing ?? fit.facing : fit.facing;
  return {
    format: 'amble-rig',
    v: 1,
    kind: fit.kind,
    facing,
    anchor: [round2(toArtX(a, fit.anchor[0])), round2(toArtY(a, fit.anchor[1]))],
    bones,
    artHash,
    made: opts.made ?? 'auto',
  };
}
