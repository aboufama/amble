/** The validator rules M5 adds (§5.7 "+" rules and the manifest checks the core lacked). */
import { describe, expect, it } from 'vitest';
import { validateGame } from '../../src/cores/ai';
import { kitManifestFor } from '../../src/pipeline/kit';
import { check, renameArtKey, worldFacts } from '../../src/pipeline/validate';
import { code, MOON_KING, PLAN_SNAIL, world } from './helpers';

const KIT = kitManifestFor();
const game = (statics: string, body = "    this.spawnHero(100, 400, 'hero');") => `class Game extends Amble.Scene {\n${statics}\n  create() {\n${body}\n  }\n}\n`;
const run = (content: string, fix = true, w?: Parameters<typeof validateGame>[1]['world']) => validateGame([{ path: 'game.js', content }], { manifest: KIT, fix, world: w });
const rules = (r: ReturnType<typeof run>) => [...r.errors, ...r.warnings].map((i) => i.rule);

describe('static art', () => {
  it('fixes near-miss words, sizes, long asks and a missing ask', () => {
    const src = game(
      "  static art = {\n    hero: { kind: 'player', rig: 'humanoid', role: 'player', w: 4, h: 5000, facing: 'front', ask: 'Draw your hero, the bravest and most wonderful space explorer who ever lived on the moon' },\n    boss: { kind: 'character', role: 'villain', w: 200, h: 180 },\n  };",
    );
    expect(rules(run(src, false))).toEqual(expect.arrayContaining(['art-manifest']));
    const r = run(src);
    expect(r.ok).toBe(true);
    const art = r.statics.art as Record<string, Record<string, unknown>>;
    expect(art.hero).toMatchObject({ kind: 'character', rig: 'biped', role: 'hero', w: 8, h: 1200, facing: 'viewer' });
    expect(String(art.hero.ask).length).toBeLessThanOrEqual(80);
    expect(art.boss).toMatchObject({ role: 'boss', ask: 'Draw the Boss' });
  });

  it('adds a missing kind from the role', () => {
    const r = run(game("  static art = { coin: { role: 'item', w: 20, h: 20 } };"));
    expect((r.statics.art as Record<string, Record<string, unknown>>).coin.kind).toBe('item');
  });

  it('refuses keys that are not camelCase words, and more than 16 pictures', () => {
    expect(run(game("  static art = { 'Moon King': { kind: 'character', ask: 'Draw it' } };"), false).errors.map((e) => e.rule)).toContain('art-manifest');
    const many = Array.from({ length: 17 }, (_, i) => `k${i}: { kind: 'item' }`).join(', ');
    expect(run(game(`  static art = { ${many} };`)).errors.map((e) => e.message).join()).toContain('keep it to 16 or fewer');
  });
});

describe('static dials', () => {
  it('swaps min and max, clamps the value, shortens the label and drops a bad for', () => {
    const r = run(game("  static art = { hero: { kind: 'character', ask: 'Draw you' } };\n  static dials = { jump: { label: 'How high the hero can possibly jump', value: 5000, min: 1100, max: 400, for: 'nobody' } };"));
    expect(r.ok).toBe(true);
    const jump = (r.statics.dials as Record<string, Record<string, unknown>>).jump;
    expect(jump).toMatchObject({ min: 400, max: 1100, value: 1100 });
    expect(String(jump.label).length).toBeLessThanOrEqual(24);
    expect(jump.for).toBeUndefined();
  });

  it('adds a label, and refuses a dial with no room to move', () => {
    const r = run(game("  static dials = { orbSpeed: { value: 3, min: 1, max: 9 }, stuck: { label: 'Stuck', value: 1, min: 1, max: 1 } };"));
    expect((r.statics.dials as Record<string, Record<string, unknown>>).orbSpeed.label).toBe('Orb speed');
    expect(r.errors.map((e) => e.message).join()).toContain('give it room to move');
  });

  it('renames a misspelt dial read to the nearest dial, and flags an unknown one', () => {
    const statics = "  static dials = { jump: { label: 'Jump', value: 700, min: 400, max: 1100 } };";
    const r = run(game(statics, "    this.spawnHero(1, 2, 'hero').platformer({ jump: () => this.dials.jmup });"));
    expect(r.files[0].content).toContain('() => this.dials.jump');
    const bad = run(game(statics, '    const x = this.dials.gravityPower;'));
    expect(bad.errors.map((e) => e.rule)).toContain('unknown-dial');
  });

  it('knows dials declared with this.tune', () => {
    const r = run(game('', "    const v = this.tune('coinValue', 10, { min: 5, max: 50 });\n    const again = this.dials.coinValue;"));
    expect(r.errors.map((e) => e.rule)).not.toContain('unknown-dial');
  });
});

describe('art is human', () => {
  const cases: Array<[string, string]> = [
    ["    const g = this.add.graphics(); g.fillRect(0, 0, 40, 64); g.generateTexture('hero', 40, 64);", 'generateTexture'],
    ["    this.textures.createCanvas('boss', 64, 64);", 'createCanvas'],
    ['    const box = this.add.rectangle(100, 100, 40, 64, 0xff0000);\n    this.physics.add.existing(box);', 'physics body'],
    ['    this.player = this.add.circle(100, 100, 20, 0x00ff00);', 'this.player'],
    ["    this.add.text(300, 300, '👾', { fontSize: 64 });", 'emoji'],
  ];
  it.each(cases)('flags %s', (body) => {
    const r = run(game('', body), false);
    expect(r.errors.map((e) => e.rule)).toContain('graphics-art');
  });

  it('leaves effects alone: particles, a laser beam, HUD text with an emoji and words', () => {
    const r = run(game('', "    this.add.particles(0, 0, 'amble-fx', { speed: 100 });\n    const beam = this.add.rectangle(480, 270, 960, 4, 0xff00ff);\n    this.ui.text(10, 10, '⭐ 10 stars');"), false);
    expect(r.errors.map((e) => e.rule)).not.toContain('graphics-art');
  });
});

describe('the world the code belongs to', () => {
  it('adds the plan keys a build forgot', () => {
    const facts = worldFacts(world({ code: [], cast: {} }), { plan: PLAN_SNAIL });
    const r = check([{ path: 'game.js', content: MOON_KING }], facts);
    expect(r.ok).toBe(true);
    expect(Object.keys(r.statics.art as object)).toEqual(expect.arrayContaining(['saltKing', 'crumb', 'leaf']));
    expect((r.statics.art as Record<string, Record<string, unknown>>).saltKing).toMatchObject({ name: 'The Salt King', ask: 'Draw the Salt King, a grumpy salt shaker', w: 140, h: 224 });
  });

  it('puts back a drawn key the code dropped', () => {
    const w = world();
    const dropped = MOON_KING.replace(/\n {4}hero: \{[^\n]*\n/, '\n');
    const r = check([{ path: 'game.js', content: dropped }], worldFacts(w));
    expect(r.ok).toBe(true);
    expect((r.statics.art as Record<string, Record<string, unknown>>).hero).toMatchObject({ name: 'Pip', rig: 'biped' });
  });

  it('keeps the drawing on its key when the code renamed it', () => {
    const renamed = MOON_KING.replace(/\bhero: \{/, 'player: {').replace(/'hero'/g, "'player'");
    const r = check([{ path: 'game.js', content: renamed }], worldFacts(world()));
    expect(r.keptKeys).toEqual([{ from: 'player', to: 'hero' }]);
    expect(r.files[0].content).toContain("spawnHero(140, 420, 'hero'");
    expect(Object.keys(r.statics.art as object)).toContain('hero');
    expect(Object.keys(r.statics.art as object)).not.toContain('player');
  });

  it('rejects a change to teacher-locked lines, wherever they moved', () => {
    const w = world({ code: [{ ...code('game.js', MOON_KING), locked: [[2, 3]] }] });
    const moved = `// A new first line.\n${MOON_KING}`;
    expect(check([{ path: 'game.js', content: moved }], worldFacts(w)).ok).toBe(true);
    const changed = MOON_KING.replace("title: 'The Moon King'", "title: 'Mine now'");
    const r = check([{ path: 'game.js', content: changed }], worldFacts(w));
    expect(r.errors.map((e) => e.rule)).toContain('locked-lines');
  });

  it('flags a line that starts with @@', () => {
    const r = run(`${MOON_KING}@@done\n`, false);
    expect(r.errors.map((e) => e.rule)).toContain('patch-directive-in-code');
  });

  it('renames string literals and art keys, not look-alikes in comments', () => {
    const out = renameArtKey([{ path: 'game.js', content: "// the boss\nconst a = { boss: 1 }; spawn(1, 2, 'boss'); x.boss = 2;" }], 'boss', 'moonKing');
    expect(out[0].content).toBe("// the boss\nconst a = { moonKing: 1 }; spawn(1, 2, 'moonKing'); x.boss = 2;");
  });
});

describe('the example and the fixtures stay valid', () => {
  it('the Moon King build fixture validates with no errors', () => {
    const r = check([{ path: 'game.js', content: MOON_KING }], worldFacts(world()));
    expect(r.errors).toEqual([]);
  });
});
