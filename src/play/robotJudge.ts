/**
 * Turns what the runtime measured during a robot test into pass/fail with reasons the AI repair prompt
 * (and a curious student) can act on. Pure.
 */
import type { RobotRaw } from './protocol';

export interface RobotThresholds {
  /** Fraction of the expected frames that must have been stepped. */
  minFrameRatio: number;
  /** Brightness variance (0..255 luma) below which the last frame counts as blank. */
  minLumaVariance: number;
  /** Pixels the hero must have travelled when it has a movement behaviour. */
  minHeroMove: number;
  maxObjects: number;
  maxMatterBodies: number;
  /** Objects may grow to at most this multiple of the count at the start (plus maxGrowthSlack). */
  maxGrowth: number;
  maxGrowthSlack: number;
}

export const ROBOT_THRESHOLDS: RobotThresholds = {
  minFrameRatio: 0.9,
  minLumaVariance: 4,
  minHeroMove: 8,
  maxObjects: 3000,
  maxMatterBodies: 250,
  maxGrowth: 3,
  maxGrowthSlack: 300,
};

export interface RobotReport extends RobotRaw {
  pass: boolean;
  /** Why it failed (empty when it passed). */
  reasons: string[];
  /** Worth knowing, but not a failure. */
  notes: string[];
  /** Something on screen moved (the hero, other objects, or the picture itself). */
  moved: boolean;
  blank: boolean;
}

export function judgeRobot(raw: RobotRaw, expectedFrames: number, t: RobotThresholds = ROBOT_THRESHOLDS): RobotReport {
  const reasons: string[] = [];
  const notes: string[] = [];
  for (const e of raw.errors.slice(0, 5)) {
    const where = e.file && e.line ? ` (line ${e.line} of ${e.file})` : '';
    reasons.push(`The game broke${where}: ${e.message}`);
  }
  if (raw.errors.length === 0 && raw.state === 'crashed') reasons.push('The game stopped with an error.');
  if (raw.frames < expectedFrames * t.minFrameRatio) {
    reasons.push(`The robot could only play ${raw.frames} of ${expectedFrames} frames.`);
  }
  const blank = raw.lumaVariance < t.minLumaVariance;
  if (blank) reasons.push('The screen stayed blank.');
  const growthCap = Math.max(raw.start.objects * t.maxGrowth, raw.start.objects + t.maxGrowthSlack);
  if (raw.peakObjects > t.maxObjects) reasons.push(`Too many things on screen (${raw.peakObjects}); it would get slow on a Chromebook.`);
  else if (raw.end.objects > growthCap) reasons.push(`Things kept piling up (${raw.start.objects} at the start, ${raw.end.objects} at the end).`);
  if (raw.peakMatterBodies > t.maxMatterBodies) reasons.push(`Too many physics bodies (${raw.peakMatterBodies}); keep it under ${t.maxMatterBodies}.`);
  const heroMoved = raw.hero.found && raw.hero.moved >= t.minHeroMove;
  if (raw.hero.found && raw.hero.controlled && !heroMoved) reasons.push("The hero didn't move when the robot pressed the controls.");
  const moved = heroMoved || raw.movers > 0 || raw.frameDiff > 0.002;
  if (!moved && !blank) reasons.push(`Nothing moved in ${Math.round(raw.gameMs / 1000)} seconds.`);
  if (raw.artMissing.length) notes.push(`Not drawn yet: ${raw.artMissing.join(', ')} (stand-ins played their part).`);
  if (raw.hero.found && !raw.hero.alive) notes.push('The robot lost the hero; check the game is fair at the start.');
  for (const w of raw.warnings.slice(0, 5)) notes.push(w);
  return { ...raw, pass: reasons.length === 0, reasons, notes, moved, blank };
}
