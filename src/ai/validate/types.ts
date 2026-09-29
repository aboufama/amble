/** Types for the game-code validator. */
import type { GameFile } from '../gameFiles';

export type { GameFile };

/**
 * The kit's API, written by the runtime (Phaser-free, so it loads in tests and workers).
 * - `globals`: names game code may use as globals besides the language and browser builtins
 *   (`Amble`, `Phaser`, and e.g. `localStorage` when the runtime provides a per-game shim for it).
 * - `sceneMethods`: members of `this` in a scene (kit and Phaser). An entry `ns.member` also
 *   declares a kit namespace (`fx.shake` declares `this.fx` with `shake`).
 * Optional extras sharpen the checks when the runtime provides them.
 */
export interface KitManifest {
  globals: string[];
  sceneMethods: string[];
  /** Kit namespaces on the scene and their members (`fx: ['shake', 'flash']`). */
  namespaces?: Record<string, string[]>;
  /** Methods of kit objects that take option objects, like behaviours (`platformer`, `shooter`). */
  actorMethods?: string[];
  /** What models reach for, mapped to the kit's name (`spawnPlayer` -> `spawnHero`). */
  synonyms?: Record<string, string>;
  /** Scene properties the kit owns, which game code must not assign (`fx`, `ui`, `music`). */
  reserved?: string[];
}

export type Severity = 'error' | 'warning';

export type RuleId =
  | 'syntax'
  | 'no-game-class'
  | 'extends-phaser-scene'
  | 'bad-base-class'
  | 'class-name'
  | 'duplicate-game-class'
  | 'duplicate-declaration'
  | 'missing-super'
  | 'async-lifecycle'
  | 'unknown-api'
  | 'unknown-global'
  | 'no-network-or-eval'
  | 'no-storage-or-parent'
  | 'no-escape'
  | 'raw-timers'
  | 'phaser2-api'
  | 'removed-api'
  | 'load-url'
  | 'spawn-arg-order'
  | 'shoot-args'
  | 'restart-every-frame'
  | 'create-in-update'
  | 'this-in-callback'
  | 'new-game'
  | 'kit-overwrite'
  | 'arcade-timescale'
  | 'no-physics-body'
  | 'infinite-loop'
  | 'undeclared-art'
  | 'dial-thunk'
  | 'static-literal'
  | 'size'
  | 'bad-path'
  | 'art-manifest'
  | 'dials-manifest'
  | 'unknown-dial'
  | 'patch-directive-in-code'
  | 'graphics-art'
  | 'plan-keys'
  | 'drawn-art-kept'
  | 'renamed-art'
  | 'locked-lines';

export interface Issue {
  rule: RuleId;
  severity: Severity;
  file: string;
  /** 1-based; 0 when the issue is about the whole game. */
  line: number;
  /** 1-based; 0 when unknown. */
  column: number;
  /** For the model (and curious students): what is wrong and how to fix it, in code terms. */
  message: string;
  /** For a student: plain words, no jargon. */
  kid: string;
}

export interface AppliedFix {
  rule: RuleId;
  file: string;
  line: number;
  description: string;
}

/** A string the game will show on screen, for the output safety check. Code identifiers are never included. */
export interface VisibleString {
  text: string;
  file: string;
  line: number;
  /** Where it appears: `config.title`, `art.ask`, `ui.big`, `add.text`, `say`, `dialogue`... */
  where: string;
}

/** An art spec as a literal (`{ kind: 'character', rig: 'blob', w: 40, ... }`). */
export type ArtLiteral = Record<string, string | number | boolean>;

/**
 * What the validator knows about the world the code belongs to (§5.7's "manifest parameter"): the
 * drawings that must keep their keys, the plan's keys, the teacher's locked lines. All optional.
 */
export interface WorldFacts {
  /** Art keys the student has drawn: they must stay in `static art` (renaming or removing one loses the drawing). */
  drawn?: readonly string[];
  /** The previous version's `static art`, to re-declare a drawn key that vanished. */
  previousArt?: Readonly<Record<string, ArtLiteral>>;
  /** The plan's cast (a build): every key must be declared; missing ones get a minimal entry. */
  planArt?: Readonly<Record<string, ArtLiteral>>;
  /** Lines a teacher locked, per file, in the previous version (1-based, inclusive). */
  locked?: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>>;
  /** The previous version's files (where the locked lines are read from). */
  previous?: readonly GameFile[];
}

export interface ValidateOptions {
  manifest: KitManifest;
  /** Apply the safe auto-fixes (default true). The result's files carry them. */
  fix?: boolean;
  /** The entry file (default `game.js`). */
  entry?: string;
  limits?: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxFileLines?: number };
  /** The world's drawings, plan and locks, for the rules that need them. */
  world?: WorldFacts;
}

export interface ValidationResult {
  /** No errors remain (after the auto-fixes, when on). */
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  fixes: AppliedFix[];
  /** The files, with the auto-fixes applied. */
  files: GameFile[];
  /** A file ends in the middle of the code: the model's reply was probably cut off. */
  truncated: boolean;
  art: { declared: string[]; used: string[]; missing: string[] };
  /** The Game class's `static` fields that are plain literals (`config`, `art`, `tune`, `dials`, `sounds`...). */
  statics: Record<string, unknown>;
  /** Text the game shows, for moderation. */
  strings: VisibleString[];
  /** Drawn keys the new code renamed (one vanished, one appeared): the drawing moves to the new key. */
  renamed: Array<{ from: string; to: string }>;
}
