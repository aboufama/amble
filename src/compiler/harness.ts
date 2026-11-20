/**
 * How a compile is carried out: how hard the model thinks for each kind of request, how art and
 * sounds are made, and whether the code is checked before the game is put together. The defaults
 * are the settings Amble ships with, all at the standard price (no faster, dearer endpoints): the
 * characters' classes before the game piece, the player asked one question about the look while the
 * game is written, and a quick change's new art started while its code is written (bench/speed.mjs,
 * bench/speed-notes.txt). `fullSize` builds the bigger
 * game the judge scored 8 (8, 8, 7) in 31-51 seconds; benchmarks (bench/harness.mjs) try others by setting
 * `globalThis.__ambleHarness` in the page before compiling.
 */
import type { ReasoningEffort } from './openai';

export interface Harness {
  /** Reasoning for the request that writes the game and its words; null = the settings' own. */
  gameEffort: ReasoningEffort | null;
  /** Reasoning for each drawing. */
  artEffort: ReasoningEffort;
  /**
   * A new game from an idea asks the player a few quick questions about what the idea leaves open
   * (the world, the looks, the colours: src/compiler/ask.ts) while the code is written, and the art
   * follows their picks instead of a theme made up for them.
   */
  ask: boolean;
  /** A quick change lists its new art before its edits, and the art starts while the edits are written. */
  streamEdits: boolean;
  /** OpenRouter: the providers for quick changes (null: providerOrder, the normal lane). */
  editProvider: Record<string, string[]> | null;
  /** How many questions (1 or 2): the art waits for the answers, so one starts it sooner. */
  askQuestions: number;
  /** Reasoning for each backdrop (null: artEffort). A backdrop at low reasoning thought 4-7 seconds before its first stroke. */
  backdropEffort: ReasoningEffort | null;
  /** Reasoning for each sound pick or design. */
  soundEffort: ReasoningEffort;
  /** Art and sound requests running at once. */
  concurrency: number;
  /**
   * How a sprite's costumes are drawn. chain: its first costume is drawn, then the others from that
   * drawing (they wait for it). sheet: one request draws all of them together. parallel: each on
   * its own, all at once (nothing waits, nothing is shared).
   */
  costumes: 'chain' | 'sheet' | 'parallel';
  /** model: the model picks a library sound or designs its own. library: the closest library sound, no request. */
  sounds: 'model' | 'library';
  /**
   * Check the code before the game is put together: art and sounds it uses but didn't ask for are
   * made too, and code that uses names that don't exist (classes, sprites) is fixed in one more
   * request, which runs while the art is being made.
   */
  lint: boolean;
  /** Reasoning for that fix. */
  repairEffort: ReasoningEffort;
  /**
   * A new game lists its art and sounds first, and they are made while the model writes the code,
   * instead of after the whole reply has arrived.
   */
  streamAssets: boolean;
  /**
   * Seconds of a trial run once the game is built (0 = none): the game plays hidden, with a few keys
   * pressed, and any error it reports is fixed in one more request before the build is done.
   */
  trialRun: number;
  /**
   * A new game is planned in one short request, then written by several requests at once (see
   * src/compiler/split.ts): `splitWriters` in all, one of them the game piece.
   */
  split: boolean;
  splitWriters: number;
  /**
   * A new game is outlined in one short streamed request, and its art, its game piece and its
   * characters' classes all start from that outline while it is still being written (see
   * src/compiler/fanout.ts). `fanoutGame`: the game piece starts once the outline's backdrops are
   * written (before the cast), or once the whole cast is.
   */
  fanout: boolean;
  fanoutGame: 'backdrops' | 'cast';
  /**
   * A new game's reply starts with a compact cast list (names, a look, costumes by name with a pose
   * each, backdrops and sounds in a few words) instead of the long asset list: the art starts a few
   * seconds in, and the code comes sooner (src/compiler/lean.ts). Needs `streamAssets`.
   */
  lean: boolean;
  /**
   * The lean reply checks its numbers before its code: a few lines on each act's length, counts and
   * speeds, and why a good first-time player wins (low reasoning otherwise writes the code without
   * that check, and the judge's most common note was a game that might not be winnable).
   */
  balance: boolean;
  /**
   * The lean reply writes its header (the cast, sounds, backdrops, a contract between the game piece
   * and the characters, the balance) and then only the game piece, while a second request writes every
   * character's class from that header at the same time: a full-size game is about half game piece and
   * half characters, so the build takes the header plus the longer half instead of all of it.
   */
  castWriter: boolean;
  /**
   * The lean reply writes the characters' classes before the game piece: a costume a class uses that
   * the cast left out is found (and drawn) about ten seconds sooner, instead of holding up the end.
   */
  spritesFirst: boolean;
  /** With `castWriter`: a one-line contract per character (its behavior is its cast description and the balance), so the second writer starts seconds sooner. */
  slimContract: boolean;
  /** Reasoning for the split and fan-out builds' writers (the plan has done the thinking). */
  writerEffort: ReasoningEffort;
  /**
   * After a new game is written, one more request reviews all of it like a tester (a walk through a
   * whole play, looking for stalls and broken logic) and fixes what it finds, while the art is made.
   * It also answers the check's problems, so it needs `lint`.
   */
  review: boolean;
  /** Repeat the size the dial asks for at the end of the request (low reasoning otherwise tends to build less). */
  sizeReminder: boolean;
  /** With the size reminder: spell out what a full game of that size has, and how long its code usually is. */
  fullSize: boolean;
  /**
   * A quick change (words added to a game already built, like a wish): the reply changes the code
   * already written by small edits, instead of writing it out again.
   */
  edits: boolean;
  /** Seconds of trial run after a quick change (the trial run of a new game is `trialRun`). */
  tweakTrial: number;
  /** OpenRouter: prefer the provider that is fastest ("throughput") or answers first ("latency"); null = OpenRouter's own choice. */
  providerSort: 'throughput' | 'latency' | null;
  /**
   * OpenRouter: by the model's maker (the part of its id before "/"), the providers that may serve
   * it, tried in this order. GPT-6.2 Sol on Azure wrote 186-215 tokens a second where OpenAI's own
   * endpoint wrote 75-82, at the same price (November 2026, three samples each). (OpenRouter's
   * "order" on its own didn't move the requests off OpenAI; with "only" it does.)
   */
  providerOrder: Record<string, string[]> | null;
  /**
   * OpenRouter: the same, for the requests that write code (the game, its fixes, quick changes),
   * which the build waits for, unlike the art. A priority endpoint here ("openai/ultrafast": about
   * 300 tokens a second, at three times the price) speeds up the build where it counts.
   */
  codeProvider: Record<string, string[]> | null;
  /**
   * Straight to OpenAI (not through OpenRouter): the service tier for the requests that write code
   * ("priority": OpenAI's faster, dearer processing; null: the account's default), and for the art.
   * The same idea as `codeProvider`'s ultrafast endpoint, for a site with an OpenAI key.
   */
  codeTier: 'priority' | null;
  /**
   * OpenRouter: the providers for backdrops (null: providerOrder). A backdrop is the biggest drawing,
   * and with a dozen drawings at once it waited longest in the queue: the fast lane ends that.
   */
  backdropProvider: Record<string, string[]> | null;
  artTier: 'priority' | null;
}

export const DEFAULT_HARNESS: Harness = {
  gameEffort: null,
  artEffort: 'low',
  backdropEffort: null,
  ask: true,
  askQuestions: 1,
  streamEdits: true,
  editProvider: null,
  soundEffort: 'low',
  concurrency: 24,
  costumes: 'sheet',
  sounds: 'library',
  lint: true,
  repairEffort: 'low',
  streamAssets: true,
  trialRun: 0,
  split: false,
  splitWriters: 4,
  fanout: false,
  fanoutGame: 'backdrops',
  lean: true,
  balance: true,
  castWriter: false,
  spritesFirst: true,
  slimContract: false,
  writerEffort: 'low',
  sizeReminder: true,
  fullSize: false,
  review: false,
  edits: true,
  tweakTrial: 0,
  providerSort: null,
  providerOrder: { openai: ['azure', 'openai'] },
  codeProvider: null,
  codeTier: null,
  backdropProvider: null,
  artTier: null,
};

/** The harness in use: the defaults, with whatever the page set in `__ambleHarness`. */
export function harness(): Harness {
  const set = (globalThis as { __ambleHarness?: Partial<Harness> }).__ambleHarness;
  return { ...DEFAULT_HARNESS, ...(set && typeof set === 'object' ? set : {}) };
}
