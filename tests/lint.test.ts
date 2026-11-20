import { describe, expect, it } from 'vitest';
import { lintGame, type LintInput } from '../src/compiler/lint';

const base = (classes: LintInput['classes'], extra: Partial<LintInput> = {}): LintInput => ({
  classes,
  costumes: new Map([
    ['Hen', new Set(['hen'])],
    ['Stage', new Set(['backdrop1'])],
  ]),
  sounds: new Set(['cluck', 'Groove']),
  sprites: new Set(['Hen', 'Rocket']),
  stage: 'Stage',
  available: (name) => ['Math', 'JSON', 'console'].includes(name),
  ...extra,
});

describe('lintGame', () => {
  it("finds another sprite's class used as if it were global (the benchmark's `Hen is not defined`)", () => {
    const r = lintGame(base([{ target: 'RollerHen', kind: 'sprite', source: 'class RollerHen extends Sprite { update(dt) { if (this.touching(Hen)) this.x += Math.random() * dt; } }' }]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/RollerHen \(line 1\): `Hen` is not defined/);
  });

  it('leaves declared names, parameters, engine names and browser globals alone', () => {
    const src = `class Hen extends Sprite {
      *start() { const { x, y: [a] } = this; let n = 0; for (const k of [1, 2]) n += k; try { JSON.parse('1'); } catch (e) { console.log(e, n, a, x); }
        const f = function inner(z = 1, ...rest) { return inner.name + z + rest.length; }; const g = (q) => q * Math.PI; this.run(function* () { yield; });
        const o = { f, g, k: Phaser.Math.Clamp(1, 0, 2) }; label: for (;;) { break label; } return o.f() + o.g(2) + arguments.length; }
    }`;
    expect(lintGame(base([{ target: 'Hen', kind: 'sprite', source: src }])).problems).toEqual([]);
  });

  it('collects costumes, backdrops and sounds used by name that nobody asked for', () => {
    const src = `class Hen extends Sprite { start() { this.costume = "hen"; this.animate(["hen", "hen_step"]); this.costume = this.flying ? "hen_fly" : "hen"; this.playSound("cluck"); this.playSound("SQUAWK"); this.game.music("groove"); this.game.backdrop = "night"; } }`;
    const r = lintGame(base([{ target: 'Hen', kind: 'sprite', source: src }]));
    expect(r.missingCostumes).toEqual([
      { target: 'Hen', name: 'hen_step' },
      { target: 'Hen', name: 'hen_fly' },
      { target: 'Stage', name: 'night' },
    ]);
    // "groove" matches "Groove": the engine finds sounds whatever their case.
    expect(r.missingSounds).toEqual(['SQUAWK']);
  });

  it('finds sprites looked up by a name no sprite has', () => {
    const src = 'class StageScript extends Stage { *game() { this.game.spawn("Chicken", { x: 0 }); this.game.find("Rocket"); this.game.findAll("Hen"); } }';
    const r = lintGame(base([{ target: 'Stage', kind: 'stage', source: src }]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/spawn\("Chicken"\), but there is no sprite named "Chicken"/);
  });

  it('finds a shot fired as a sprite nobody made', () => {
    const src = 'class Hen extends Sprite { start() { this.every(1, () => this.shoot("Egg", { at: "Rocket", hits: "Rocket" })); this.shoot("Rocket"); } }';
    const r = lintGame(base([{ target: 'Hen', kind: 'sprite', source: src }]));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/shoot\("Egg"\), but there is no sprite named "Egg"/);
  });

  it("finds sprite helpers called on the stage, and leaves the stage's own and the class's own alone", () => {
    const src = `class StageScript extends Stage {
      *game() { this._script("x", function* () {}); this._compare(1, 2); this.helper(); this.run(function* () { yield* this.tween(this.vars, { a: 1 }, 1); yield* this.wait(1); }); this.say("hi"); yield* this.glideTo("mouse", 1); this.speak = () => 1; this.speak(); }
      helper() { this.nextBackdrop(); }
    }`;
    const r = lintGame(base([{ target: 'Stage', kind: 'stage', source: src }]));
    expect(r.problems).toHaveLength(2);
    expect(r.problems[0]).toMatch(/this\.say\(\) doesn't exist on the stage/);
    expect(r.problems[1]).toMatch(/this\.glideTo\(\) doesn't exist on the stage/);
  });

  it("leaves `this` alone where it is another object's (a generator handed to a sprite's run)", () => {
    const src = `class StageScript extends Stage {
      *game() { const bird = this.game.find("Hen"); bird.run(function* () { yield* this.tween(this, { size: 45 }, 0.2); this.destroy(); }); this.run(function* () { this.say("hi"); }); this.after(1, () => this.hide()); }
    }`;
    const r = lintGame(base([{ target: 'Stage', kind: 'stage', source: src }]));
    expect(r.problems).toEqual([expect.stringMatching(/this\.say\(\) doesn't exist on the stage/), expect.stringMatching(/this\.hide\(\) doesn't exist on the stage/)]);
  });

  it("skips code that doesn't parse (the parse check reports it)", () => {
    expect(lintGame(base([{ target: 'Hen', kind: 'sprite', source: 'class Hen extends Sprite { start( { }' }]))).toEqual({ missingCostumes: [], missingSounds: [], problems: [] });
  });
});
