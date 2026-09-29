import { describe, expect, it } from 'vitest';
import { codeFrame, formatIssue, formatIssuesForModel } from '../../src/ai/validate/format';
import { instrument } from '../../src/ai/validate/instrument';
import { peekStaticLiteral } from '../../src/ai/validate/statics';
import type { KitManifest, ValidationResult } from '../../src/ai/validate/types';
import { validateCode, validateGame } from '../../src/ai/validate/validate';
import { PROBE_MANIFEST } from './fixtures/probeManifest';

const KIT: KitManifest = { ...PROBE_MANIFEST, sceneMethods: [...PROBE_MANIFEST.sceneMethods, 'tune'] };
const game = (body: string, statics = '') => `class Game extends Amble.Scene {\n${statics}  create() {\n${body}\n  }\n}\n`;
const rules = (r: ValidationResult) => [...r.errors, ...r.warnings].map((i) => i.rule);
const check = (body: string, manifest = KIT) => validateCode(game(body), { manifest, fix: false });

describe('forbidden APIs (defense in depth behind the sandbox)', () => {
  const cases: Array<[string, string]> = [
    ["fetch('https://x.org');", 'no-network-or-eval'],
    ["window.fetch('https://x.org');", 'no-network-or-eval'],
    ["globalThis['fetch']('https://x.org');", 'no-network-or-eval'],
    ["const r = new XMLHttpRequest();", 'no-network-or-eval'],
    ["new WebSocket('wss://x.org');", 'no-network-or-eval'],
    ["new EventSource('/events');", 'no-network-or-eval'],
    ["new RTCPeerConnection();", 'no-network-or-eval'],
    ["new Worker('w.js');", 'no-network-or-eval'],
    ["import('https://x.org/m.js');", 'no-network-or-eval'],
    ["eval('1 + 1');", 'no-network-or-eval'],
    ["const e = eval; e('1');", 'no-network-or-eval'],
    ["Function('return 1')();", 'no-network-or-eval'],
    ["new Function('return 1');", 'no-network-or-eval'],
    ["setTimeout('alert(1)', 10);", 'no-network-or-eval'],
    ["navigator.sendBeacon('/x', 'data');", 'no-network-or-eval'],
    ["const c = document.cookie;", 'no-storage-or-parent'],
    ["localStorage.setItem('k', 1);", 'no-storage-or-parent'],
    ["sessionStorage.clear();", 'no-storage-or-parent'],
    ["indexedDB.open('db');", 'no-storage-or-parent'],
    ["caches.open('c');", 'no-storage-or-parent'],
    ["parent.document.title = 'x';", 'no-storage-or-parent'],
    ["top.focus();", 'no-storage-or-parent'],
    ["window.opener.close();", 'no-storage-or-parent'],
    ["location.href = 'https://x.org';", 'no-escape'],
    ["window.location = 'https://x.org';", 'no-escape'],
    ["document.location.assign('https://x.org');", 'no-escape'],
    ["location.replace('https://x.org');", 'no-escape'],
    ["window.open('https://x.org');", 'no-escape'],
    ["open('https://x.org');", 'no-escape'],
    ["postMessage('hi', '*');", 'no-escape'],
    ["window.parent.postMessage('hi', '*');", 'no-escape'],
    ["new BroadcastChannel('c');", 'no-escape'],
    ["document.createElement('iframe');", 'no-escape'],
    ["document.body.innerHTML = '<img src=x>';", 'no-escape'],
    ["document.write('<p>hi</p>');", 'no-escape'],
  ];
  it.each(cases)('flags %s', (line, rule) => {
    const r = check(line);
    expect(rules(r)).toContain(rule);
    expect(r.ok).toBe(false);
    const issue = r.errors.find((e) => e.rule === rule);
    expect(issue?.line).toBe(3);
    expect(issue?.kid).toMatch(/^Line 3: games can't/);
  });

  it('leaves look-alikes alone: the game\'s own names, properties, reading location', () => {
    const r = check([
      "const top = 10; const parent = { x: 1 }; const open = () => 1; open();",
      "this.hero = this.spawnHero(100, top, 'hero'); this.hero.parentContainer; this.cameras.main.worldView.top;",
      "const fetcher = { fetch: (x) => x }; fetcher.fetch(1); const s = { location: 'here' }; s.location = 'there';",
      "const where = location.hash; const self2 = this; self2.add.text(1, 2, 'Hi');",
      "this.time.delayedCall(500, () => this.win('Yay'));",
    ].join('\n'));
    expect(r.errors).toEqual([]);
  });

  it('allows storage when the runtime provides a per-game shim for it', () => {
    const line = "localStorage.setItem('best', 10);";
    expect(rules(check(line))).toContain('no-storage-or-parent');
    expect(rules(check(line, { ...KIT, globals: [...KIT.globals, 'localStorage'] }))).not.toContain('no-storage-or-parent');
  });
});

describe('dials stay live', () => {
  const fixCode = (body: string) => validateCode(game(body), { manifest: KIT }).files[0].content;

  it('wraps plain dial reads in kit options into arrow functions', () => {
    const out = fixCode("    this.player = this.spawnHero(140, 420, 'hero').platformer({ speed: this.dials.speed, jump: this.dials['jump'], jumps: 2 });");
    expect(out).toContain("platformer({ speed: () => this.dials.speed, jump: () => this.dials['jump'], jumps: 2 })");
  });

  it('covers every way to read a dial, nested options and dial arithmetic', () => {
    const out = fixCode(
      [
        '    const dials = this.dials;',
        "    this.spawnEnemy(700, 200, 'boss', { hp: this.tune('bossHp', 150, { min: 50, max: 400 }) });",
        "    this.player.shooter({ key: 'shot', every: dials.fireRate, speed: this.tune.shotSpeed * 2, dash: { speed: this.dial.dash } });",
        '    this.fx.shake({ amount: Math.min(this.dials.shake, 0.05) });',
      ].join('\n'),
    );
    expect(out).toContain("{ hp: () => this.tune('bossHp', 150, { min: 50, max: 400 }) }");
    expect(out).toContain('every: () => dials.fireRate, speed: () => this.tune.shotSpeed * 2, dash: { speed: () => this.dial.dash } }');
    expect(out).toContain('{ amount: () => Math.min(this.dials.shake, 0.05) }');
  });

  it('records the fix, and warns instead when not fixing', () => {
    const code = game("    this.spawnHero(1, 2, 'hero').runner({ speed: this.dials.speed });");
    const fixed = validateCode(code, { manifest: KIT });
    expect(fixed.fixes).toEqual([{ rule: 'dial-thunk', file: 'game.js', line: 3, description: 'speed: this.dials.speed -> () => this.dials.speed' }]);
    expect(fixed.warnings.filter((w) => w.rule === 'dial-thunk')).toEqual([]);
    const warned = validateCode(code, { manifest: KIT, fix: false });
    expect(warned.warnings.find((w) => w.rule === 'dial-thunk')).toMatchObject({ rule: 'dial-thunk', line: 3, message: '`speed: this.dials.speed` reads the dial once; write `speed: () => this.dials.speed` so it stays live.' });
  });

  it('leaves dial reads outside option objects, functions, and non-kit calls alone', () => {
    const body = [
      "    this.player = this.spawnHero(1, 2, 'hero').platformer({ speed: () => this.dials.speed, jump: 720 });",
      '    this.gravity = this.dials.gravity;',
      '    this.tweens.add({ targets: this.player, y: this.dials.height, duration: 300 });',
      "    this.add.text(10, 10, 'hi', { fontSize: this.dials.size });",
      '    this.physics.world.gravity.y = this.dials.gravity;',
      "    this.player.platformer({ speed: this.rand(1, 5), jump: this.dials.jump + this.rand(1, 2) });",
    ].join('\n');
    const r = validateCode(game(body), { manifest: KIT });
    expect(r.fixes).toEqual([]);
    expect(r.files[0].content).toBe(game(body));
  });

  it('never double-wraps: a second run changes nothing', () => {
    const once = fixCode("    this.spawnHero(1, 2, 'hero').platformer({ speed: this.dials.speed });");
    expect(validateCode(once, { manifest: KIT }).fixes).toEqual([]);
  });
});

describe('names', () => {
  it('calls a bare kit method a sure crash, and other unknown names a warning', () => {
    const r = check("    spawnHero(100, 400, 'hero');\n    const x = mystery + 1;\n    if (typeof maybe !== 'undefined') console.log('maybe');");
    expect(r.errors.map((e) => [e.rule, e.message])).toContainEqual(['unknown-global', '`spawnHero` is not defined. Kit methods live on the scene: use `this.spawnHero`.']);
    expect(r.warnings.filter((w) => w.rule === 'unknown-global').map((w) => w.kid)).toEqual(["Line 4: \"mystery\" isn't defined anywhere."]);
  });

  it('knows names declared in other files of the same game', () => {
    const files = [
      { path: 'boss.js', content: 'class Boss {\n  constructor(scene) { this.scene = scene; this.hp = 10; }\n  hit() { this.hp--; this.flash(); }\n  flash() {}\n}\nconst BOSS_SPEED = 120;\n' },
      { path: 'game.js', content: game("    this.boss = new Boss(this);\n    this.speed = BOSS_SPEED;") },
    ];
    const r = validateGame(files, { manifest: KIT });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('only lets game.js declare the Game class', () => {
    const r = validateGame([{ path: 'extra.js', content: 'class Game {}' }, { path: 'game.js', content: game('') }], { manifest: KIT });
    expect(r.errors.map((e) => [e.rule, e.file])).toEqual([['duplicate-game-class', 'extra.js']]);
  });

  it('skips kit checks when the manifest lists no scene methods', () => {
    expect(rules(check('    this.anything(); this.fx.whatever();', { globals: [], sceneMethods: [] }))).not.toContain('unknown-api');
  });

  it('reads namespaces from dotted scene methods', () => {
    const r = check('    this.fx.shake(); this.fx.wobble();', { globals: ['Amble'], sceneMethods: ['fx.shake', 'fx.flash', 'spawn'] });
    expect(r.errors.map((e) => e.message)).toEqual(['`this.fx.wobble()` does not exist.']);
  });
});

describe('game shape and size', () => {
  it('needs game.js with class Game extends Amble.Scene', () => {
    expect(rules(validateGame([{ path: 'boss.js', content: 'class Boss {}' }], { manifest: KIT }))).toContain('no-game-class');
    expect(rules(validateCode('class Level extends Something {}', { manifest: KIT, fix: false }))).toEqual(expect.arrayContaining(['bad-base-class', 'class-name']));
    expect(rules(validateCode('const x = 1;', { manifest: KIT }))).toContain('no-game-class');
  });

  it('warns about async lifecycle methods', () => {
    expect(rules(validateCode('class Game extends Amble.Scene { async create() { await 1; } }', { manifest: KIT }))).toContain('async-lifecycle');
  });

  it('keeps manifest statics plain, so the editor can read them without running the game', () => {
    const r = validateCode(game('', "  static config = { title: 'A' };\n  static art = { hero: { kind: 'character', w: 40 * 2 } };\n  static helper = makeHelper();\n"), { manifest: KIT });
    expect(r.warnings.map((w) => [w.rule, w.line])).toContainEqual(['static-literal', 3]);
    expect(r.statics).toEqual({ config: { title: 'A' } });
    expect(r.art.declared).toEqual(['hero']);
  });

  it('limits file names, file sizes and file counts', () => {
    const big = `${game('')}\n// ${'x'.repeat(45_000)}`;
    const files = [
      { path: 'game.js', content: big },
      { path: '../escape.js', content: '' },
      { path: 'Levels/one.js', content: '' },
      ...Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.js`, content: '' })),
    ];
    const r = validateGame(files, { manifest: KIT });
    expect(r.errors.filter((e) => e.rule === 'bad-path').map((e) => e.file)).toEqual(['../escape.js']);
    expect(r.errors.filter((e) => e.rule === 'size').map((e) => e.message)).toEqual([expect.stringMatching(/at most 12 files/), expect.stringMatching(/game\.js is 45 KB/)]);
  });
});

describe('visible strings (for the output safety check)', () => {
  it('collects shown text and never code', () => {
    const code = game(
      [
        "    this.ui.big('YOU WIN!', { color: '#ffffff' });",
        "    this.add.text(10, 10, 'Score: ' + this.score, { fontSize: 20 });",
        "    this.boss.say(`I am ${this.name}!`);",
        "    const taunts = ['Too slow!', 'Missed me!'];",
        "    this.lose(this.hp > 0 ? 'Out of time' : 'Bonked!');",
        "    this.killSlime(); const bloodParticles = 3; this.spawn(1, 2, 'hero');",
      ].join('\n'),
      "  static config = { title: 'Slime Party', physics: 'arcade' };\n  static art = { hero: { kind: 'character', ask: 'Draw your hero', about: 'A brave kid' } };\n",
    );
    const r = validateCode(code, { manifest: KIT, fix: false });
    expect(r.strings.map((s) => [s.where, s.text])).toEqual([
      ['config.title', 'Slime Party'],
      ['art.ask', 'Draw your hero'],
      ['art.about', 'A brave kid'],
      ['ui.big', 'YOU WIN!'],
      ['add.text', 'Score:'],
      ['boss.say', 'I am  … !'],
      ['dialogue', 'Too slow!'],
      ['dialogue', 'Missed me!'],
      ['lose', 'Out of time'],
      ['lose', 'Bonked!'],
    ]);
  });
});

describe('instrumentation', () => {
  it('guards every loop on the same line', () => {
    const code = 'for (let i = 0; i < 3; i++) x++;\nwhile (a) {\n  b();\n}\ndo { c(); } while (d);\nfor (const k in o) {}\nfor (const v of list) f(v);';
    const r = instrument(code, { sourceUrl: 'amble:///game.js' });
    expect(r.loops).toBe(5);
    expect(r.code).toBe(
      'for (let i = 0; i < 3; i++) { __amble.guard(); x++; }\nwhile (a) { __amble.guard();\n  b();\n}\ndo { __amble.guard(); c(); } while (d);\nfor (const k in o) { __amble.guard();}\nfor (const v of list) { __amble.guard(); f(v); }\n//# sourceURL=amble:///game.js',
    );
    expect(instrument('while (true) {', { guard: 'g()' })).toEqual({ code: 'while (true) {', loops: 0 });
  });
});

describe('streaming helpers and formatting', () => {
  it('reads a static literal as soon as it is complete', () => {
    const full = "class Game extends Amble.Scene {\n  static art = {\n    hero: { kind: 'character', ask: 'Draw \\'your\\' hero {' }, // a } in a comment\n    boss: { kind: 'character' },\n  };\n  create() {";
    const cut = full.indexOf('boss');
    expect(peekStaticLiteral(full.slice(0, cut), 'art')).toBeUndefined();
    expect(peekStaticLiteral(full, 'art')).toEqual({ hero: { kind: 'character', ask: "Draw 'your' hero {" }, boss: { kind: 'character' } });
    expect(peekStaticLiteral(full, 'config')).toBeUndefined();
  });

  it('formats issues for the model and frames code', () => {
    const r = check("    fetch('x');");
    expect(formatIssue(r.errors[0])).toBe('game.js:3:5 error [no-network-or-eval] `fetch` is not allowed in games: no network and no running strings as code. Remove it.');
    expect(formatIssuesForModel([...r.warnings, ...r.errors], 1).split('\n')[0]).toMatch(/ error /);
    expect(codeFrame('a\nb\nc\nd\ne', 3, 1)).toBe('  2 | b\n> 3 | c\n  4 | d');
  });
});
