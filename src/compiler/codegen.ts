/**
 * Compiles a sprite's (or the stage's) blocks into the class the engine runs.
 *
 * Like Scratch's own compiler, each script becomes a coroutine that the right hook starts, and
 * exact blocks become direct engine calls, so they compile instantly and the same way every
 * time. Blocks written in the author's own words become "pieces": small methods whose code comes
 * from the compile request. A piece is identified by its content (the words, the block, the
 * sprite, whether it repeats), so words that didn't change keep their code from one compile to
 * the next, unless a compile rewrites them to fit other changes (words anywhere can change how
 * the whole game works, so a compile request sees every piece and may revise any of them).
 */
import { BLOCK_BY_TYPE, type CharacterSpecial } from '../blocks/spec';
import { hashString } from '../project/ids';
import type { Project, Target } from '../project/types';
import { blockText, characterLabel, inputBlock, isDisabled, oneLine, topBlocks, type JsonBlock } from './serialize';

/**
 * - action: runs where the block is; the script waits for it (a generator).
 * - timed: like action, but takes `seconds` of game time (a generator with a `seconds` parameter).
 * - condition: true or false, checked often (a plain method that returns a boolean).
 * - value: a number or words (a plain method that returns it).
 * - message: the text on the win / game over banner (a plain method that returns it).
 * - behavior: starts with each copy of the sprite and keeps running in the background (a generator).
 * - rule: starts once when the game starts and keeps running in the background (a generator).
 */
export type PieceKind = 'action' | 'timed' | 'condition' | 'value' | 'message' | 'behavior' | 'rule';

export interface PieceRequest {
  /** Content hash: the same words in the same place always get the same code. */
  key: string;
  method: string;
  kind: PieceKind;
  targetId: string;
  targetName: string;
  /** The author's words. */
  words: string;
  /** The whole block as text, e.g. `do [jump up high] for (1) seconds`. */
  block: string;
  /** Runs again and again (inside a loop, or in a script that runs every frame). */
  inLoop: boolean;
  /** The script (or standalone block) it belongs to, e.g. `when ⚑ clicked`. */
  script: string;
}

export interface TargetPlan {
  targetId: string;
  targetName: string;
  kind: 'sprite' | 'stage';
  className: string;
  pieces: PieceRequest[];
  warnings: string[];
  /** The warnings that are about one block, with its id (to show them on it). */
  issues: Array<{ blockId: string; text: string }>;
  /** The block each script and standalone line starts at, by its text (to show run problems on it). */
  scripts: ReadonlyMap<string, string>;
  /** Brief blocks (game, made for, art style) in this target, as text. */
  brief: string[];
  /** Which piece each block (by id) became, to point at it in the compile request. */
  markers: ReadonlyMap<string, string>;
  /** The class source, given the code of each piece by key (missing pieces do nothing yet). */
  render(code: ReadonlyMap<string, string>): string;
}

const lit = (v: unknown): string => JSON.stringify(v);

/** The key names the engine uses. */
function engineKey(menuValue: string): string {
  const k = menuValue.trim().toLowerCase();
  const arrows: Record<string, string> = { 'up arrow': 'up', 'down arrow': 'down', 'left arrow': 'left', 'right arrow': 'right' };
  return arrows[k] ?? (k || 'space');
}

export function pieceKey(parts: { kind: PieceKind; target: string; type: string; words: string; inLoop: boolean; mode: string }): string {
  const text = JSON.stringify({ v: 1, ...parts });
  return hashString(text) + hashString(`amble:${text}`);
}

const SIGNATURES: Record<PieceKind, (method: string) => string> = {
  action: (m) => `*${m}()`,
  timed: (m) => `*${m}(seconds)`,
  condition: (m) => `${m}()`,
  value: (m) => `${m}()`,
  message: (m) => `${m}()`,
  behavior: (m) => `*${m}()`,
  rule: (m) => `*${m}()`,
};

/** What a piece does before its code is written (or if it can't be). */
export const PIECE_STUBS: Record<PieceKind, string> = {
  action: '',
  timed: 'yield* this.wait(seconds);',
  condition: 'return false;',
  value: 'return 0;',
  message: 'return "";',
  behavior: '',
  rule: '',
};

/** How a piece's code is wrapped into a method. */
export function pieceSignature(kind: PieceKind, method: string): string {
  return SIGNATURES[kind](method);
}

/** Reporters whose code always gives a finite number. */
const NUMERIC_REPORTERS = new Set(['nm_random', 'nm_math', 'nm_distance', 'nm_my', 'nm_timer', 'nm_count']);

function isNumberLiteral(expr: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(expr);
}

interface Who {
  kind: CharacterSpecial | 'sprite' | 'none';
  name: string;
  expr: string;
}

class TargetCompiler {
  readonly pieces = new Map<string, PieceRequest>();
  readonly markers = new Map<string, string>();
  readonly warnings: string[] = [];
  readonly issues: Array<{ blockId: string; text: string }> = [];
  readonly scripts = new Map<string, string>();
  /** The block being compiled, for warnings about it. */
  private at: string | undefined;
  readonly brief: string[] = [];
  private readonly starts: string[] = [];
  private readonly spawns: string[] = [];
  private readonly keys: string[] = [];
  private readonly clicks: string[] = [];
  private readonly messages: string[] = [];
  private readonly updates: string[] = [];
  private readonly methods: string[] = [];
  private readonly skills = new Map<string, string>();
  private readonly defined = new Set<string>();
  private readonly locals: Set<string>;
  private readonly characterNames: Set<string>;
  private readonly isStage: boolean;
  private scriptCount = 0;
  private edgeCount = 0;
  private loopCount = 0;
  private loopDepth = 0;
  private repeating = false;
  private script = '';
  /** The type of the hat the current script starts with. */
  private hatType = '';

  constructor(
    private readonly project: Project,
    private readonly target: Target,
    private readonly className: string,
  ) {
    this.isStage = target.kind === 'stage';
    this.locals = new Set(target.kind === 'sprite' ? (target.variables ?? []) : []);
    this.characterNames = new Set([...project.sprites.map((s) => s.name), ...(project.compiled?.sprites ?? []).map((s) => s.name)]);
  }

  private warn(message: string): void {
    const text = `${this.target.name}: ${message}`;
    if (!this.warnings.includes(text)) this.warnings.push(text);
    if (this.at && !this.issues.some((i) => i.blockId === this.at && i.text === message)) this.issues.push({ blockId: this.at, text: message });
  }

  compile(): void {
    const tops = topBlocks(this.target.blocks).filter((b) => !isDisabled(b));
    // Skills first, so "use skill" works wherever the skill is.
    for (const b of tops) {
      const name = b.type === 'pr_define' ? oneLine(b.fields?.NAME) : '';
      if (name && !this.skills.has(name)) this.skills.set(name, `_k${this.skills.size + 1}`);
    }
    for (const b of tops) {
      this.at = b.id;
      const spec = BLOCK_BY_TYPE.get(b.type);
      if (!spec) {
        this.warn(`Skipped a block Amble doesn't know ("${b.type}").`);
        continue;
      }
      if (spec.shape === 'rule') this.standalone(b);
      else if (spec.shape === 'hat') this.hat(b);
      // Anything else loose in the code area doesn't run, like in Scratch.
    }
  }

  // ---------------------------------------------------------------------------
  // Scripts
  // ---------------------------------------------------------------------------

  private hat(b: JsonBlock): void {
    const label = blockText(b);
    this.script = label;
    this.at = b.id;
    if (b.id && !this.scripts.has(label)) this.scripts.set(label, b.id);
    this.hatType = b.type;
    if (b.type === 'pr_define') {
      const name = oneLine(b.fields?.NAME);
      const method = this.skills.get(name);
      if (!method || this.defined.has(name)) {
        this.warn(`There are two skills called "${name}"; only the first one is used.`);
        return;
      }
      this.defined.add(name);
      this.method(method, label, b.next?.block);
      return;
    }
    const method = `_s${++this.scriptCount}`;
    const run = (restart: boolean) => `this._script(${lit(method)}, ${restart}, ${lit(label)})`;
    const field = (name: string) => oneLine(b.fields?.[name]);
    switch (b.type) {
      case 'ev_start':
        this.starts.push(`${run(true)};`);
        break;
      case 'ev_key': {
        const key = engineKey(field('KEY'));
        this.keys.push(key === 'any' ? `${run(false)};` : `if (key === ${lit(key)}) ${run(false)};`);
        break;
      }
      case 'ev_hold':
        this.repeating = true;
        this.updates.push(`if (this.game.input.isDown(${lit(engineKey(field('KEY')))})) ${run(false)};`);
        break;
      case 'ev_click':
      case 'ev_stage_click':
        this.clicks.push(`${run(true)};`);
        break;
      case 'ev_touch':
        this.edge(this.touching(b, 'WHO'), `${run(false)};`);
        break;
      case 'ev_when': {
        const cond = this.condition(b, 'COND');
        if (cond === 'false') this.warn(`"${label}" needs a condition in its slot.`);
        else this.edge(cond, `${run(false)};`);
        break;
      }
      case 'ev_every':
        this.starts.push(`this.every(Math.max(0.05, ${this.number(b, 'SECONDS')}), () => ${run(false)});`);
        break;
      case 'ev_receive':
        this.messages.push(`if (name === ${lit(field('MESSAGE'))}) started.push(${run(true)});`);
        break;
      case 'ev_created':
        this.spawns.push(`${run(false)};`);
        break;
      default:
        this.warn(`"${label}" can't start a script.`);
        return;
    }
    this.method(method, label, b.next?.block);
    this.repeating = false;
  }

  /** Runs `run` each time `cond` becomes true (not every frame while it stays true). */
  private edge(cond: string, run: string): void {
    const flag = `_e${++this.edgeCount}`;
    const now = cond.startsWith('!!') || cond.startsWith('this._compare(') ? cond : `!!(${cond})`;
    this.updates.push(`{ const now = ${now}; if (now && !this.${flag}) ${run} this.${flag} = now; }`);
  }

  private method(name: string, label: string, first: JsonBlock | undefined): void {
    this.script = label;
    const body = this.chain(first, 2);
    this.methods.push(`  // ${label}`, `  *${name}() {`, ...body, '  }');
  }

  private chain(first: JsonBlock | undefined, depth: number): string[] {
    const out: string[] = [];
    for (let b = first; b; b = b.next?.block) {
      if (!isDisabled(b)) out.push(...this.statement(b, depth));
    }
    return out;
  }

  /** The body of a loop: its blocks, then a pause until the next frame (like Scratch). */
  private loop(b: JsonBlock, depth: number): string[] {
    this.loopDepth++;
    const body = this.chain(b.inputs?.SUBSTACK?.block, depth + 1);
    this.loopDepth--;
    return [...body, `${'  '.repeat(depth + 1)}yield;`];
  }

  private statement(b: JsonBlock, depth: number): string[] {
    this.at = b.id;
    const pad = '  '.repeat(depth);
    const line = (code: string) => [pad + code];
    const spec = BLOCK_BY_TYPE.get(b.type);
    if (!spec) {
      this.warn(`Skipped a block Amble doesn't know ("${b.type}").`);
      return [];
    }
    if (spec.targets && !spec.targets.includes(this.target.kind)) {
      this.warn(`"${blockText(b)}" only works on ${spec.targets.includes('sprite') ? 'sprites' : 'the stage'}.`);
      return [];
    }
    const field = (name: string) => oneLine(b.fields?.[name]);
    switch (b.type) {
      // ---- Triggers (messages)
      case 'ev_broadcast':
        return line(`this.broadcast(${lit(field('MESSAGE'))});`);
      case 'ev_broadcast_wait':
        return line(`yield* this.broadcastAndWait(${lit(field('MESSAGE'))});`);

      // ---- Characters
      case 'cp_make': {
        const who = this.who(b, 'WHO');
        if (who.kind === 'me') return this.isStage ? [] : line('this.clone();');
        if (who.kind === 'sprite') return line(`this.game.cloneOf(${lit(who.name)});`);
        this.warn(`"${blockText(b)}": pick me or a sprite to copy.`);
        return [];
      }
      case 'co_delete_clone':
        return line('if (this.isClone) { this.destroy(); return; }');

      // ---- Motion
      case 'mv_move':
        return line(this.move(field('DIR'), this.number(b, 'STEPS')));
      case 'mv_turn': {
        const degrees = this.number(b, 'DEGREES');
        const right = field('DIR') !== 'left';
        // Angles go counter-clockwise, so turning right is negative.
        return line(`this.turn(${right ? `-(${degrees})` : degrees});`);
      }
      case 'mv_goto': {
        const who = this.who(b, 'WHO');
        return who.kind === 'me' || who.kind === 'none' ? [] : line(`this.goTo(${who.expr});`);
      }
      case 'mv_goto_xy':
        return line(`this.setPosition(${this.number(b, 'X')}, ${this.number(b, 'Y')});`);
      case 'mv_toward': {
        const who = this.who(b, 'WHO');
        return who.kind === 'me' || who.kind === 'none' ? [] : line(`this.moveTowards(${who.expr}, ${this.number(b, 'STEPS')});`);
      }
      case 'mv_point': {
        const who = this.who(b, 'WHO');
        return who.kind === 'me' || who.kind === 'none' ? [] : line(`this.pointTowards(${who.expr});`);
      }
      case 'mv_bounce':
        return line('this.bounceOffEdges();');
      case 'mv_stay':
        return line('this.keepOnStage();');

      // ---- Game
      case 'ga_do':
        return line(`yield* this.${this.piece(b, 'action', 'ACTION')}();`);
      case 'ga_do_for':
        return line(`yield* this.${this.piece(b, 'timed', 'ACTION')}(Math.max(0, ${this.number(b, 'SECONDS')}));`);
      case 'kit_walk':
        return line(`this.walkWith(${lit(field('KEYS'))}, ${this.number(b, 'SPEED')});`);
      case 'kit_jump':
        return line(`this.jumpWith(${lit(engineKey(field('KEY')))}, ${this.number(b, 'POWER')});`);
      case 'kit_gravity':
        return line('this.fallWithGravity();');
      case 'kit_solid':
        return line('this.beSolid();');
      case 'mo_physics':
      case 'ga_camera':
      case 'ga_effect':
        return line(`yield* this.${this.piece(b, 'action', 'HOW')}();`);
      case 'kit_follow':
        return line('this.game.camera.follow(this);');
      case 'kit_shake':
        return line('this.game.camera.shake(8, 0.3);');
      case 'ga_win':
      case 'ga_over':
        return line(`this.game.${b.type === 'ga_win' ? 'win' : 'over'}(${this.bannerMessage(b)});`);

      // ---- Looks
      case 'lk_say':
        return line(`this.say(${this.value(b, 'TEXT')});`);
      case 'lk_say_for':
        return line(`yield* this.sayFor(${this.value(b, 'TEXT')}, ${this.number(b, 'SECONDS')});`);
      case 'lo_costume':
        return line(`this.${this.isStage ? 'backdrop' : 'costume'} = ${lit(field('COSTUME'))};`);
      case 'lo_next_costume':
        return line(this.isStage ? 'this.nextBackdrop();' : 'this.nextCostume();');
      case 'lk_animate':
        return line(`this.animate(undefined, ${this.number(b, 'FPS')});`);
      case 'lk_animate_stop':
        return line('this.stopAnimation();');
      case 'lo_backdrop': {
        const choice = field('BACKDROP');
        if (choice === 'next backdrop') return line('this.game.nextBackdrop();');
        if (choice === 'previous backdrop') return line('this.game.previousBackdrop();');
        if (choice === 'random backdrop') return line('this.game.randomBackdrop();');
        return line(`this.game.backdrop = ${lit(choice)};`);
      }
      case 'lk_size':
        return line(`this.size = ${this.number(b, 'SIZE')};`);
      case 'lk_grow':
        return line(`this.size += ${this.number(b, 'SIZE')};`);
      case 'lo_show':
        return line('this.show();');
      case 'lo_hide':
        return line('this.hide();');
      case 'lo_layer':
        return line(field('LAYER') === 'back' ? 'this.sendToBack();' : 'this.bringToFront();');

      // ---- Sound
      case 'so_play':
        return line(`this.playSound(${lit(field('SOUND'))});`);
      case 'so_play_wait':
        return line(`yield* this.playSoundUntilDone(${lit(field('SOUND'))});`);
      case 'sd_music':
        return line(`this.game.music(${lit(field('SOUND'))});`);
      case 'so_stop':
        return line('this.game.stopAllSounds();');

      // ---- Flow
      case 'fl_wait':
        return line(`yield* this.wait(${this.number(b, 'SECONDS')});`);
      case 'fl_repeat': {
        const n = ++this.loopCount;
        return [pad + `for (let i${n} = 0, n${n} = Math.floor(${this.number(b, 'TIMES')}); i${n} < n${n}; i${n}++) {`, ...this.loop(b, depth), pad + '}'];
      }
      case 'co_forever':
        return [pad + 'for (;;) {', ...this.loop(b, depth), pad + '}'];
      case 'fl_if':
        this.checkedOnce(b);
        return [pad + `if (${this.condition(b, 'COND')}) {`, ...this.chain(b.inputs?.SUBSTACK?.block, depth + 1), pad + '}'];
      case 'fl_if_else':
        this.checkedOnce(b);
        return [
          pad + `if (${this.condition(b, 'COND')}) {`,
          ...this.chain(b.inputs?.SUBSTACK?.block, depth + 1),
          pad + '} else {',
          ...this.chain(b.inputs?.SUBSTACK2?.block, depth + 1),
          pad + '}',
        ];
      case 'fl_wait_until':
        return line(`yield* this.waitUntil(() => ${this.condition(b, 'COND')});`);
      case 'fl_repeat_until':
        return [pad + `while (!(${this.condition(b, 'COND')})) {`, ...this.loop(b, depth), pad + '}'];
      case 'fl_stop':
        return line('return;');

      // ---- Memory
      case 'mem_set':
        return line(`${this.variable(field('VARIABLE'))} = ${this.value(b, 'VALUE', true)};`);
      case 'mem_change': {
        const v = this.variable(field('VARIABLE'));
        return line(`${v} = (Number(${v}) || 0) + ${this.number(b, 'AMOUNT')};`);
      }
      case 'va_show': {
        const name = field('VARIABLE');
        return line(`this.game.ui.value(${lit(name)}, () => ${this.variable(name)});`);
      }
      case 'mem_ask':
        return line(`yield* this.game.ask(${this.value(b, 'QUESTION')});`);

      // ---- Skills
      case 'pr_call': {
        const method = this.skills.get(field('NAME'));
        if (!method) {
          this.warn(`There's no skill called "${field('NAME')}".`);
          return [];
        }
        return line(`yield* this.${method}();`);
      }
      default:
        this.warn(`"${blockText(b)}" can't go in a script.`);
        return [];
    }
  }

  private move(direction: string, steps: string): string {
    const neg = isNumberLiteral(steps) ? String(-Number(steps)) : `-(${steps})`;
    switch (direction) {
      case 'right':
        return `this.x += ${steps};`;
      case 'left':
        return `this.x -= ${steps};`;
      case 'up':
        return `this.y += ${steps};`;
      case 'down':
        return `this.y -= ${steps};`;
      case 'backward':
        return `this.moveForward(${neg});`;
      default:
        return `this.moveForward(${steps});`;
    }
  }

  // ---------------------------------------------------------------------------
  // Standalone blocks: brief, rules, checks
  // ---------------------------------------------------------------------------

  private standalone(b: JsonBlock): void {
    const label = blockText(b);
    this.script = label;
    this.at = b.id;
    if (b.id && !this.scripts.has(label)) this.scripts.set(label, b.id);
    const spec = BLOCK_BY_TYPE.get(b.type);
    if (spec?.targets && !spec.targets.includes(this.target.kind)) {
      this.warn(`"${label}" only works on ${spec.targets.includes('sprite') ? 'sprites' : 'the stage'}.`);
      return;
    }
    switch (b.type) {
      case 'br_game':
      case 'br_audience':
        this.brief.push(label);
        return;
      case 'br_style': {
        // The look of the whole game: set up once, when the game starts (and a guide for new art).
        this.brief.push(label);
        const method = this.piece(b, 'rule', 'STYLE');
        this.starts.push(`this._script(${lit(method)}, false, ${lit(label)});`);
        return;
      }
      case 'br_win':
      case 'br_lose': {
        const cond = this.condition(b, 'COND');
        if (cond === 'false') this.warn(`"${label}" needs a condition in its slot.`);
        else this.updates.push(`if (${this.isStage ? '' : '!this.isClone && '}${cond}) this.game.${b.type === 'br_win' ? 'win' : 'over'}();`);
        return;
      }
      case 'ga_rule': {
        const method = this.piece(b, 'rule', 'RULE');
        this.starts.push(`this._script(${lit(method)}, false, ${lit(label)});`);
        return;
      }
      case 'ru_always':
      case 'ru_never': {
        const method = this.piece(b, 'behavior', 'RULE');
        const run = `this._script(${lit(method)}, false, ${lit(label)});`;
        this.starts.push(run);
        this.spawns.push(run);
        return;
      }
      case 'ru_check': {
        const cond = this.condition(b, 'COND');
        if (cond === 'false') this.warn(`"${label}" needs a condition in its slot.`);
        else this.updates.push(`if (!(${cond})) this.game._checkFailed(this.name, ${lit(label)});`);
        return;
      }
      default:
        this.warn(`"${label}" can't stand on its own.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------

  /** A character slot. */
  private who(b: JsonBlock, name: string): Who {
    const v = inputBlock(b, name);
    if (!v || (v.type !== 'char_menu' && v.type !== 'char_ref')) {
      this.warn(`"${blockText(b)}" needs a character.`);
      return { kind: 'none', name: '', expr: 'null' };
    }
    const n = oneLine(v.fields?.NAME);
    switch (n) {
      case 'me':
        return { kind: 'me', name: n, expr: 'this' };
      case 'mouse':
        return { kind: 'mouse', name: n, expr: lit('mouse') };
      case 'random':
        return { kind: 'random', name: n, expr: lit('random') };
      case 'center':
        return { kind: 'center', name: n, expr: '{ x: 0, y: 0, z: 0 }' };
      case 'edge':
        return { kind: 'edge', name: n, expr: lit('edge') };
      case 'anyone':
        return { kind: 'anyone', name: n, expr: 'undefined' };
    }
    if (!this.characterNames.has(n)) this.warn(`There's no character called "${n}".`);
    return { kind: 'sprite', name: n, expr: lit(n) };
  }

  private touching(b: JsonBlock, name: string): string {
    if (this.isStage) {
      this.warn(`The stage can't touch anything ("${blockText(b)}").`);
      return 'false';
    }
    const who = this.who(b, name);
    switch (who.kind) {
      case 'anyone':
        return '!!this.touching()';
      case 'edge':
      case 'mouse':
      case 'sprite':
        return `!!this.touching(${who.expr})`;
      default:
        this.warn(`"${blockText(b)}": pick someone to touch.`);
        return 'false';
    }
  }

  /**
   * "if <words>" right in a script that runs once (the start, or a new copy) is checked just that
   * once, like in Scratch. Words there usually describe something to wait for ("killed 5
   * enemies"), so say how to keep checking it.
   */
  private checkedOnce(b: JsonBlock): void {
    if (this.loopDepth > 0 || this.repeating || (this.hatType !== 'ev_start' && this.hatType !== 'ev_created')) return;
    const words = (v: JsonBlock | undefined): JsonBlock | undefined => {
      if (!v || isDisabled(v)) return undefined;
      if (v.type === 'cd_words') return v;
      return words(inputBlock(v, 'A')) ?? words(inputBlock(v, 'B'));
    };
    const cond = words(inputBlock(b, 'COND'));
    if (!cond) return;
    const text = blockText(cond);
    this.warn(`"if <${text}> then" is checked only once, when "${this.script}" runs. To keep checking it, put it inside "forever", or start a script with "when <${text}>".`);
  }

  /** A condition slot (empty slots are false). */
  private condition(b: JsonBlock, name: string): string {
    const v = b.inputs?.[name]?.block;
    return v && !isDisabled(v) ? this.bool(v) : 'false';
  }

  private bool(v: JsonBlock): string {
    const field = (name: string) => oneLine(v.fields?.[name]);
    switch (v.type) {
      case 'cd_touching':
        return this.touching(v, 'WHO');
      case 'cd_key':
        return `this.game.input.isDown(${lit(engineKey(field('KEY')))})`;
      case 'cd_mouse':
        return 'this.game.input.mouse.down';
      case 'cd_ground':
        return this.isStage ? 'false' : 'this.isOnGround()';
      case 'cd_compare':
        return `this._compare(${this.value(v, 'A', true)}, ${lit(field('OP') || '=')}, ${this.value(v, 'B', true)})`;
      case 'cd_and':
        return `(${this.condition(v, 'A')} && ${this.condition(v, 'B')})`;
      case 'cd_or':
        return `(${this.condition(v, 'A')} || ${this.condition(v, 'B')})`;
      case 'cd_not':
        return `!(${this.condition(v, 'A')})`;
      case 'cd_words':
        return `this.${this.piece(v, 'condition', 'TEXT')}()`;
      default:
        this.warn(`"${blockText(v)}" isn't a condition.`);
        return 'false';
    }
  }

  /** A number slot, as an expression that is always a number. */
  private number(b: JsonBlock, name: string): string {
    const v = inputBlock(b, name);
    if (!v) return '0';
    if (v.type === 'sh_num' || v.type === 'sh_txt') {
      const n = Number(oneLine(v.type === 'sh_num' ? v.fields?.NUM : v.fields?.TEXT));
      return Number.isFinite(n) ? String(n) : '0';
    }
    const expr = this.reporter(v);
    return NUMERIC_REPORTERS.has(v.type) ? expr : `(Number(${expr}) || 0)`;
  }

  /** A value slot (words or a number). With `numeric`, typed numbers stay numbers. */
  private value(b: JsonBlock, name: string, numeric = false): string {
    const v = inputBlock(b, name);
    if (!v) return lit('');
    if (v.type === 'sh_txt') {
      const text = String(v.fields?.TEXT ?? '');
      if (numeric && text.trim() !== '' && Number.isFinite(Number(text))) return String(Number(text));
      return lit(text);
    }
    if (v.type === 'sh_num') return String(Number(v.fields?.NUM) || 0);
    return this.reporter(v);
  }

  private reporter(v: JsonBlock): string {
    switch (v.type) {
      case 'mem_var':
        return this.variable(oneLine(v.fields?.VARIABLE));
      case 'nm_answer':
        return 'this.game.lastAnswer';
      case 'nm_random':
        return `this.random(${this.number(v, 'A')}, ${this.number(v, 'B')})`;
      case 'nm_math': {
        const op = oneLine(v.fields?.OP);
        if (op === '÷') return `this._divide(${this.number(v, 'A')}, ${this.number(v, 'B')})`;
        const ops: Record<string, string> = { '+': '+', '-': '-', '×': '*' };
        return `(${this.number(v, 'A')} ${ops[op] ?? '+'} ${this.number(v, 'B')})`;
      }
      case 'nm_distance': {
        const who = this.who(v, 'WHO');
        if (who.kind === 'me' || who.kind === 'none') return '0';
        return `this.distanceTo(${who.expr})`;
      }
      case 'nm_my':
        return this.myProperty(oneLine(v.fields?.PROP));
      case 'nm_timer':
        return 'this.game.time';
      case 'nm_count': {
        const who = this.who(v, 'WHO');
        return `this.game.count(${who.kind === 'me' ? 'this.name' : lit(who.name)})`;
      }
      case 'nm_words':
        return `this.${this.piece(v, 'value', 'TEXT')}()`;
      case 'char_menu':
      case 'char_ref':
        return lit(characterLabel(oneLine(v.fields?.NAME)));
      default:
        if (BLOCK_BY_TYPE.get(v.type)?.shape === 'boolean') return `(${this.bool(v)})`;
        this.warn(`"${blockText(v)}" doesn't give a value.`);
        return '0';
    }
  }

  private myProperty(prop: string): string {
    if (this.isStage) return '0';
    switch (prop) {
      case 'x':
        return 'this.x';
      case 'y':
        return 'this.y';
      case 'size':
        return 'this.size';
      case 'direction':
        // Scratch-style direction: 90 = right, 0 = up.
        return '((((90 - this.angle) % 360) + 540) % 360 - 180)';
      case 'costume number':
        return '(this.costumes.indexOf(this.costume) + 1)';
      default:
        return '0';
    }
  }

  private variable(name: string): string {
    return this.locals.has(name) ? `this.vars[${lit(name)}]` : `this.game.vars[${lit(name)}]`;
  }

  /** The banner text of "win the game" / "game over": nothing, exact quoted words, or a piece. */
  private bannerMessage(b: JsonBlock): string {
    const how = oneLine(b.fields?.HOW);
    if (!how) return '';
    const quoted = /^(?:and\s+)?(?:show|say|display)?\s*["“]([^"”]*)["”]\s*$/i.exec(how);
    if (quoted) return lit(quoted[1]);
    return `this.${this.piece(b, 'message', 'HOW')}()`;
  }

  private piece(b: JsonBlock, kind: PieceKind, field: string): string {
    const words = oneLine(b.fields?.[field]);
    const inLoop = this.loopDepth > 0 || this.repeating;
    const key = pieceKey({ kind, target: this.target.name, type: b.type, words, inLoop, mode: this.project.mode });
    const method = `_w${key.slice(0, 10)}`;
    if (!this.pieces.has(key)) {
      this.pieces.set(key, { key, method, kind, targetId: this.target.id, targetName: this.target.name, words, block: blockText(b), inLoop, script: this.script });
    }
    if (b.id) this.markers.set(b.id, key);
    return method;
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  render(code: ReadonlyMap<string, string>): string {
    const out: string[] = [`// ${this.isStage ? 'The stage' : this.target.name}, compiled from its blocks.`, `class ${this.className} extends ${this.isStage ? 'Stage' : 'Sprite'} {`];
    const hook = (signature: string, lines: string[]) => {
      if (lines.length) out.push(`  ${signature} {`, ...lines.map((l) => `    ${l}`), '  }');
    };
    // Variables start at 0 each game: the stage sets the ones for all sprites (it starts first).
    const inits = this.isStage
      ? projectVariables(this.project).map((v) => `this.game.vars[${lit(v)}] = 0;`)
      : [...this.locals].map((v) => `this.vars[${lit(v)}] = 0;`);
    hook('start()', [...inits, ...this.starts]);
    hook('onSpawn()', this.spawns);
    hook('onKeyDown(key)', this.keys);
    hook('onClick()', this.clicks);
    if (this.messages.length) {
      out.push('  *onMessage(name) {', '    const started = [];', ...this.messages.map((l) => `    ${l}`), '    while (started.some((c) => c && !c.done)) yield;', '  }');
    }
    hook('update(dt)', this.updates);
    out.push(...this.methods);
    for (const p of this.pieces.values()) {
      const body = code.get(p.key) ?? PIECE_STUBS[p.kind];
      const lines = body.trim() ? body.split('\n').map((l) => (l.trim() ? `    ${l}` : '')) : [];
      out.push(`  // ${p.block}`, `  ${pieceSignature(p.kind, p.method)} {`, ...lines, '  }');
    }
    out.push('}');
    return out.join('\n');
  }
}

const VARIABLE_BLOCKS = new Set(['mem_set', 'mem_change', 'va_show', 'mem_var']);

/** Variables for all sprites (older projects don't list them: then the blocks that use them count). */
export function projectVariables(project: Project): string[] {
  if (project.variables) return [...project.variables];
  const local = new Set(project.sprites.flatMap((s) => s.variables ?? []));
  const names = new Set<string>();
  const visit = (b: JsonBlock | undefined): void => {
    for (; b; b = b.next?.block) {
      const name = VARIABLE_BLOCKS.has(b.type) ? oneLine(b.fields?.VARIABLE) : '';
      if (name && !local.has(name)) names.add(name);
      for (const slot of Object.values(b.inputs ?? {})) {
        visit(slot.block);
        visit(slot.shadow);
      }
    }
  };
  for (const t of [project.stage, ...project.sprites]) for (const b of topBlocks(t.blocks)) visit(b);
  return [...names].sort();
}

/** Plans one target: what the compile request must write, and how to put its class together. */
export function planTarget(project: Project, target: Target, className: string): TargetPlan {
  const c = new TargetCompiler(project, target, className);
  c.compile();
  return {
    targetId: target.id,
    targetName: target.name,
    kind: target.kind,
    className,
    pieces: [...c.pieces.values()],
    warnings: c.warnings,
    issues: c.issues,
    scripts: c.scripts,
    brief: c.brief,
    markers: c.markers,
    render: (code) => c.render(code),
  };
}
