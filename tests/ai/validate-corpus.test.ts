/**
 * The games probe's corpus of typical model mistakes (games-probe/tools/validate.test.mjs), each
 * with the rules it must trigger, plus the probe's demo games, which must come out clean.
 */
import { describe, expect, it } from 'vitest';
import type { RuleId } from '../../src/ai/validate/types';
import { validateCode } from '../../src/ai/validate/validate';
import boss from './fixtures/games/boss.js?raw';
import broken from './fixtures/games/broken.js?raw';
import chaos from './fixtures/games/chaos.js?raw';
import runner from './fixtures/games/runner.js?raw';
import { PROBE_MANIFEST } from './fixtures/probeManifest';

const cases: Array<[string, RuleId[], string]> = [
  ['phaser 2 code', ['extends-phaser-scene', 'phaser2-api'], `class Game extends Phaser.Scene {
  create() {
    game.physics.startSystem(Phaser.Physics.ARCADE);
    this.player = game.add.sprite(100, 100, 'hero');
    game.physics.arcade.enable(this.player);
    this.player.anchor.setTo(0.5, 0.5);
  }
}`],
  ['removed 3.60 apis', ['removed-api'], `class Game extends Amble.Scene {
  create() {
    const particles = this.add.particles('spark');
    const emitter = particles.createEmitter({ speed: 100 });
    this.tweens.timeline({ tweens: [{ targets: this.hero, x: 100 }] });
  }
}`],
  ['this in callbacks', ['this-in-callback'], `class Game extends Amble.Scene {
  create() {
    this.points = 0;
    this.time.addEvent({ delay: 1000, loop: true, callback: function () { this.points++; } });
    this.input.on('pointerdown', function (p) { this.fx.burst(p.x, p.y); });
  }
}`],
  ['urls in preload', ['load-url', 'undeclared-art'], `class Game extends Amble.Scene {
  preload() {
    this.load.image('sky', 'https://labs.phaser.io/assets/skies/space3.png');
    this.load.audio('jump', 'assets/jump.mp3');
  }
  create() { this.add.image(480, 270, 'sky'); this.sound.play('jump'); }
}`],
  ['objects every frame', ['create-in-update'], `class Game extends Amble.Scene {
  update() {
    this.add.text(10, 10, 'Score: ' + this.score);
    this.add.circle(this.hero.x, this.hero.y, 4, 0xffffff);
  }
}`],
  ['missing super + new game', ['missing-super', 'new-game'], `class Game extends Amble.Scene {
  constructor() { this.speed = 5; }
}
const game = new Phaser.Game({ scene: Game });`],
  ['infinite loop', ['infinite-loop'], `class Game extends Amble.Scene {
  create() { let x = 0; while (true) { x++; } }
}`],
  ['network and storage', ['no-network-or-eval', 'no-storage-or-parent'], `class Game extends Amble.Scene {
  create() { fetch('https://example.com/scores'); localStorage.setItem('hi', 1); }
}`],
  ['display sprite used as physics', ['no-physics-body', 'undeclared-art'], `class Game extends Amble.Scene {
  create() { const ball = this.add.sprite(100, 100, 'ball'); ball.setVelocity(200, 0); }
}`],
  ['kit overwrite + arcade timescale', ['kit-overwrite', 'arcade-timescale'], `class Game extends Amble.Scene {
  create() { this.music = this.sound.add('theme'); this.physics.world.timeScale = 0.5; }
}`],
  ['spawn arg order', ['spawn-arg-order', 'undeclared-art'], `class Game extends Amble.Scene {
  create() { this.hero = this.spawnHero('hero', 100, 300); }
}`],
  ['truncated output', ['syntax'], `class Game extends Amble.Scene {
  create() { this.hero = this.spawnHero(100, 300, 'hero');
`],
  ['phaser 2 timers and tweens', ['phaser2-api'], `class Game extends Amble.Scene {
  create() { this.game.time.events.add(1000, this.spawnWave, this); this.add.tween(this.hero).to({ x: 100 }, 500, 'Linear', true); }
}`],
  ['restart every frame', ['restart-every-frame'], `class Game extends Amble.Scene { update() { this.scene.restart(); } }`],
  ['hallucinated kit api', ['unknown-api'], `class Game extends Amble.Scene {
  create() { this.player = this.spawnPlayer(100, 300, 'hero'); this.fx.explosion(100, 100); this.fx.screenShake(0.02); this.helper(); }
  helper() {}
}`],
  ['eval', ['no-network-or-eval'], `class Game extends Amble.Scene { create() { eval('1+1'); new Function('return 1'); } }`],
];

const options = { manifest: PROBE_MANIFEST };

describe('the probe corpus', () => {
  it.each(cases)('catches %s', (_name, expected, code) => {
    const r = validateCode(code, options);
    const got = new Set([...r.errors, ...r.warnings, ...r.fixes].map((x) => x.rule));
    for (const rule of expected) expect(got, `rules: ${[...got].join(', ')}`).toContain(rule);
  });

  it('catches all 16 cases', () => {
    const caught = cases.filter(([, expected, code]) => {
      const r = validateCode(code, options);
      const got = new Set([...r.errors, ...r.warnings, ...r.fixes].map((x) => x.rule));
      return expected.every((e) => got.has(e));
    });
    expect(caught).toHaveLength(16);
  });

  it('suggests the real kit names for hallucinated ones, and fixes the confident ones', () => {
    const code = cases.find((c) => c[0] === 'hallucinated kit api')?.[2] ?? '';
    const before = validateCode(code, { ...options, fix: false });
    expect(before.errors.map((e) => e.message)).toEqual([
      '`this.spawnPlayer()` does not exist; did you mean `this.spawnHero()`?',
      '`this.fx.explosion()` does not exist; did you mean `this.fx.explode()`?',
      '`this.fx.screenShake()` does not exist; did you mean `this.fx.shake()`?',
    ]);
    const after = validateCode(code, options);
    expect(after.ok).toBe(true);
    expect(after.fixes.map((f) => f.description)).toEqual(['this.spawnPlayer -> this.spawnHero', 'this.fx.explosion -> explode', 'this.fx.screenShake -> shake']);
    expect(after.files[0].content).toContain('this.spawnHero(100, 300');
    expect(after.files[0].content).toContain('this.fx.explode(100, 100)');
  });

  it('auto-fixes callbacks, base classes, super(), URL loads and display sprites', () => {
    const cb = validateCode(cases[2][2], options);
    expect(cb.ok).toBe(true);
    expect(cb.files[0].content).toContain('callback: () => { this.points++; }');
    expect(cb.files[0].content).toContain("this.input.on('pointerdown', (p) => { this.fx.burst(p.x, p.y); });");

    const p2 = validateCode(cases[0][2], options);
    expect(p2.files[0].content).toMatch(/^class Game extends Amble\.Scene/);
    expect(p2.fixes.map((f) => f.rule)).toContain('extends-phaser-scene');

    const sup = validateCode(cases[5][2], options);
    expect(sup.files[0].content).toContain('constructor() { super();  this.speed = 5; }');
    expect(sup.errors.map((e) => e.rule)).toEqual(['new-game']);

    const urls = validateCode(cases[3][2], options);
    expect(urls.files[0].content).toContain("/* this.load.image('sky', 'https://labs.phaser.io/assets/skies/space3.png'); (removed: no network) */");
    expect(urls.art.missing).toEqual(['sky']);

    const body = validateCode(cases[8][2], options);
    expect(body.files[0].content).toContain("const ball = this.physics.add.sprite(100, 100, 'ball')");
  });

  it('keeps line numbers through every fix', () => {
    for (const [, , code] of cases) {
      const r = validateCode(code, options);
      expect(r.files[0].content.split('\n').length, code.slice(0, 40)).toBe(code.split('\n').length);
    }
  });

  it('flags truncated output', () => {
    const r = validateCode(cases[11][2], options);
    expect(r.truncated).toBe(true);
    expect(r.errors[0]).toMatchObject({ rule: 'syntax', line: 3 });
    expect(r.errors[0].message).toMatch(/cut off/);
  });
});

describe('the probe demo games', () => {
  const games: Record<string, string> = { boss, broken, chaos, runner };
  const fixture = (name: string) => games[name];

  it.each(['boss', 'chaos', 'runner'])('%s is clean, with a complete art manifest', (name) => {
    const r = validateCode(fixture(name), options);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.fixes).toEqual([]);
    expect(r.art.missing).toEqual([]);
    expect(r.art.declared.length).toBeGreaterThanOrEqual(6);
  });

  it('reads the statics the editor needs', () => {
    const r = validateCode(fixture('boss'), options);
    expect(r.statics.config).toMatchObject({ title: 'MOON KING', physics: 'arcade', gravity: 1500 });
    expect(Object.keys(r.statics.art as object)).toEqual(['hero', 'boss', 'minion', 'ground', 'ledge', 'shot', 'orb', 'bomb']);
  });

  it('passes the deliberately broken game, whose bug only shows at runtime', () => {
    expect(validateCode(fixture('broken'), options).errors).toEqual([]);
  });
});
