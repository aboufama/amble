/**
 * The robot test (§5.8): the candidate plays for 6 s of game time in the warm spare, on the player core's
 * manual clock, with the world's dials, twists and drawings, and `judgeRobot` says whether it holds up.
 * Loops are guarded first (`Amble.__loop()` at the top of every loop body, line numbers unchanged).
 */
import { instrument } from '../cores/ai';
import { DEFAULT_PLAYER_PREFS, judgeRobot, PLAYER_CORE, type InitMessage, type PlayerError, type RobotRaw } from '../cores/play';
import { NotBuiltYet } from '../model/notBuilt';
import type { CodeFile, World } from '../model/types';
import type { FixError } from './userMessage';

/** What the pipeline needs from a robot run. */
export interface RobotOutcome {
  pass: boolean;
  reasons: string[];
  errors: FixError[];
  warnings: string[];
  /** For the next request's "Last robot test:" line. */
  summary: string;
}

/** The runtime's loop guard (src/runtime/kit: `Amble.__loop`). */
export const LOOP_GUARD = 'Amble.__loop()';
export const ROBOT_GAME_MS = 6000;
/** A robot run that takes longer than this in wall time is abandoned (the player core stops at 10 s). */
const WALL_LIMIT_MS = 45_000;

export function instrumentFiles(init: InitMessage): InitMessage {
  return { ...init, files: init.files.map((f) => ({ name: f.name, source: instrument(f.source, { guard: LOOP_GUARD }).code })) };
}

export function fixErrorOf(e: PlayerError): FixError {
  return { file: e.file ?? 'game.js', line: e.line ?? 0, column: e.column ?? 0, phase: e.phase, message: e.message, count: e.count || 1 };
}

export function robotSummary(raw: RobotRaw, pass: boolean): string {
  const secs = Math.round(raw.gameMs / 1000);
  const hero = raw.hero.found ? (raw.hero.moved >= 8 ? 'hero moved' : 'hero did not move') : 'no hero';
  const errors = raw.errors.length ? `${raw.errors.length} error${raw.errors.length > 1 ? 's' : ''}` : 'no errors';
  return `${pass ? 'passed' : 'failed'} · ${secs} s · ${hero} · ${errors}`;
}

export function outcomeOf(raw: RobotRaw): RobotOutcome {
  const verdict = judgeRobot(raw);
  const errors = raw.errors.map(fixErrorOf);
  // A verdict without a thrown error (blank, frozen, nothing moved) still needs words the model can act on.
  if (!verdict.pass && !errors.length) for (const r of verdict.reasons) errors.push({ file: 'game.js', line: 0, column: 0, phase: 'robot', message: r, count: 1 });
  return { pass: verdict.pass, reasons: verdict.reasons, errors, warnings: raw.warnings.slice(-5), summary: robotSummary(raw, verdict.pass) };
}

export interface RobotRunner {
  /** Null when there is no player to test with (then the change is accepted untested). */
  (files: readonly CodeFile[], o: { signal: AbortSignal; seed: number }): Promise<RobotOutcome | null>;
}

interface HostLike {
  robot(init: InitMessage): Promise<{ raw: RobotRaw }>;
}

/** The robot test through the app's PlayerHost and M2's `toInitMessage`. */
export function playerRobot(host: HostLike, world: () => World, toInit: (w: World, o: { mode: 'robot'; prefs: typeof DEFAULT_PLAYER_PREFS; robot: { gameMs: number; seed: number; bot: 'auto' }; autostart: boolean }) => Promise<InitMessage>): RobotRunner {
  return async (files, o) => {
    if (PLAYER_CORE === 'stub') return null;
    const prefs = { ...DEFAULT_PLAYER_PREFS, muted: true, errorPanel: false, touch: 'off' as const, quality: 1 as const, ghostTaps: false };
    const init = instrumentFiles(await toInit({ ...world(), code: [...files] }, { mode: 'robot', prefs, robot: { gameMs: ROBOT_GAME_MS, seed: o.seed, bot: 'auto' }, autostart: true }));
    if (o.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The robot test took too long.')), WALL_LIMIT_MS);
      });
      const { raw } = await Promise.race([host.robot(init), limit]);
      return outcomeOf(raw);
    } catch (err) {
      if (err instanceof NotBuiltYet) return null;
      if (o.signal.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return { pass: false, reasons: [message], errors: [{ file: 'game.js', line: 0, column: 0, phase: 'frozen', message, count: 1 }], warnings: [], summary: 'failed · the game froze' };
    } finally {
      clearTimeout(timer);
    }
  };
}
