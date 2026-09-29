/** The state one file's validation shares between rules: issues, fixes, art keys and the scene classes. */
import type { AnyNode, Class, MethodDefinition, Program } from 'acorn';
import type MagicString from 'magic-string';
import { columnOf, lineOf } from './ast';
import type { Api } from './manifest';
import { kidMessage, type KidContext } from './messages';
import type { AppliedFix, Issue, RuleId, Severity } from './types';

/** Facts about the whole game, gathered before the per-file rules run. */
export interface GameFacts {
  api: Api;
  /** Members of scene classes: methods, fields and `this.x = ...` assignments. */
  own: Set<string>;
  /** Every name the game declares anywhere (files share one scope). */
  declared: Set<string>;
  artDeclared: Set<string>;
  artUsed: Set<string>;
  /** Dials declared `live: false`: a change restarts the level, so a single read of one is right. */
  restartDials: ReadonlySet<string>;
  /** Method names the game calls anywhere (`this.level(...)`, `scene.shoot(...)`). */
  called: ReadonlySet<string>;
}

export class FileContext {
  readonly issues: Issue[] = [];
  readonly fixes: AppliedFix[] = [];
  private readonly seen = new Set<string>();

  constructor(
    readonly file: string,
    readonly code: string,
    readonly ast: Program,
    readonly ms: MagicString,
    readonly fix: boolean,
    readonly facts: GameFacts,
    /** Classes whose `this` is a scene: the Game class and anything extending Amble.Scene or Phaser.Scene. */
    readonly sceneClasses: ReadonlySet<AnyNode>,
    /** The entry file's Game class, when this is the entry file. */
    readonly gameClass: Extract<AnyNode, Class> | null,
  ) {}

  get api(): Api {
    return this.facts.api;
  }

  /** `update()` methods of the scene classes. */
  updateMethods(): MethodDefinition[] {
    const out: MethodDefinition[] = [];
    for (const cls of this.sceneClasses) {
      if (cls.type !== 'ClassDeclaration' && cls.type !== 'ClassExpression') continue;
      for (const m of cls.body.body) if (m.type === 'MethodDefinition' && m.key.type === 'Identifier' && m.key.name === 'update') out.push(m);
    }
    return out;
  }

  /** Records an issue once per rule, line and name. */
  add(severity: Severity, rule: RuleId, node: AnyNode | null, message: string, kid: Omit<KidContext, 'line'> = {}): void {
    const line = lineOf(node);
    const key = `${rule}:${line}:${kid.name ?? message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ rule, severity, file: this.file, line, column: columnOf(node), message, kid: kidMessage(rule, { line, ...kid }) });
  }

  /** Applies a fix (when fixing) through `edit`, and records it. */
  applyFix(rule: RuleId, node: AnyNode | null, description: string, edit: () => void): boolean {
    if (!this.fix) return false;
    edit();
    this.fixes.push({ rule, file: this.file, line: lineOf(node), description });
    return true;
  }
}
