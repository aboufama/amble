import { describe, expect, it } from 'vitest';
import { lintGame } from '../src/compiler/lint';
import { instrumentTargetCode } from '../src/compiler/transform';
import { evaluateClass } from '../src/engine/sandbox';
import { evaluationOrder, lateClass } from '../src/engine/game';

// Kinds of one character (a faster hen, a boss hen) as sprites of their own that build on its class.
const hen = 'class Hen extends Sprite { start() { this.costume = "hen"; this.animate(["hen_walk", "hen"]); this.speed = 2; } static SPEED = 2; }';
const sprinter = 'class Sprinter extends Hen { start() { super.start(); this.speed = 5; } }';

describe('sprites whose classes build on each other', () => {
  it('compiles a class that extends another sprite class', () => {
    const r = instrumentTargetCode(sprinter, 'sprite');
    expect(r.errors).toEqual([]);
    expect(r.className).toBe('Sprinter');
    // The stage still has to be a Stage.
    expect(instrumentTargetCode('class Boss extends Hen {}', 'stage').errors).toHaveLength(1);
  });

  it('evaluates the base first, then the classes that name it, with it in scope', () => {
    const items = [
      { t: { kind: 'stage', className: 'StageScript', code: 'class StageScript extends Stage { start() { Hen.SPEED; } }' } },
      { t: { kind: 'sprite', className: 'Sprinter', code: sprinter } },
      { t: { kind: 'sprite', className: 'Hen', code: hen } },
    ];
    expect(evaluationOrder(items).map((i) => i.t.className)).toEqual(['Hen', 'StageScript', 'Sprinter']);
    class Sprite {}
    const Hen = evaluateClass(hen, 'Hen', 'Hen', { Sprite }) as { SPEED: number; prototype: object };
    const S = evaluateClass(sprinter, 'Sprinter', 'Sprinter', { Sprite, Hen }) as { prototype: object };
    expect(S.prototype instanceof (Hen as unknown as typeof Sprite)).toBe(true);
    // Code may declare its own name that the scope has too (it runs in a block of its own).
    const Own = evaluateClass('const Hen = 3; class Coop extends Sprite { n() { return Hen; } }', 'Coop', 'Coop', { Sprite, Hen }) as new () => { n(): number };
    expect(new Own().n()).toBe(3);
    // Cycles keep the targets' own order.
    const loop = [
      { t: { kind: 'sprite', className: 'A', code: 'class A extends Sprite { x() { return B; } }' } },
      { t: { kind: 'sprite', className: 'B', code: 'class B extends A {}' } },
    ];
    expect(evaluationOrder(loop).map((i) => i.t.className)).toEqual(['A', 'B']);
  });

  it("lets a class use one evaluated after it (Hen's code names Queen, and Queen extends Hen)", () => {
    class Sprite {}
    const classes = new Map<string, unknown>();
    const queenLater = lateClass('Queen', classes);
    const Hen = evaluateClass('class Hen extends Sprite { isQueen() { return this instanceof Queen; } static boss() { return new Queen().crown + Queen.TITLE; } }', 'Hen', 'Hen', { Sprite, Queen: queenLater }) as new () => { isQueen(): boolean };
    classes.set('Hen', Hen);
    expect(() => (Hen as unknown as { boss(): string }).boss()).toThrow(/Queen is not defined yet/);
    const Queen = evaluateClass('class Queen extends Hen { crown = "👑"; static TITLE = "the Queen"; }', 'Queen', 'Queen', { Sprite, Hen }) as new () => object;
    classes.set('Queen', Queen);
    expect(new Queen() instanceof Hen).toBe(true);
    expect(new Queen() instanceof (Hen as unknown as typeof Sprite)).toBe(true);
    expect((new Queen() as { isQueen(): boolean }).isQueen()).toBe(true);
    expect(new Hen().isQueen()).toBe(false);
    expect((Hen as unknown as { boss(): string }).boss()).toBe('👑the Queen');
  });

  it("is no problem to the check, which gives the new sprite the costumes its base's code uses", () => {
    const r = lintGame({
      classes: [
        { target: 'Hen', kind: 'sprite', source: hen },
        { target: 'Sprinter', kind: 'sprite', source: sprinter },
        { target: 'Stage', kind: 'stage', source: 'class StageScript extends Stage { *game() { this.game.spawn("Sprinter"); Hen.SPEED; } }' },
      ],
      costumes: new Map([
        ['Hen', new Set(['hen', 'hen_walk'])],
        ['Sprinter', new Set(['hen'])],
      ]),
      sounds: new Set(),
      sprites: new Set(['Hen', 'Sprinter']),
      stage: 'Stage',
      available: () => false,
    });
    expect(r.problems).toEqual([]);
    expect(r.missingCostumes).toEqual([{ target: 'Sprinter', name: 'hen_walk' }]);
  });

  it('still finds a class nobody has, and names the ones there are', () => {
    const r = lintGame({
      classes: [
        { target: 'Hen', kind: 'sprite', source: hen },
        { target: 'Dash', kind: 'sprite', source: 'class Dash extends Chicken {}' },
      ],
      costumes: new Map([['Hen', new Set(['hen', 'hen_walk'])]]),
      sounds: new Set(),
      sprites: new Set(['Hen', 'Dash']),
      stage: 'Stage',
      available: () => false,
    });
    expect(r.problems).toEqual([expect.stringMatching(/Dash \(line 1\): `Chicken` is not defined\. No sprite's class is called Chicken \(they are Hen, Dash\)/)]);
  });
});
