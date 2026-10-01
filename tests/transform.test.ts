import { describe, expect, it } from 'vitest';
import { instrumentTargetCode } from '../src/compiler/transform';

/** Evaluates instrumented code with a stub base class, returning the class. */
function evaluate(code: string, className: string, base: new () => object) {
  const guardYield = () => false;
  const guardThrow = () => {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('Sprite', 'Stage', '__ambleGuardYield', '__ambleGuardThrow', `${code}\n;return ${className};`)(
    base,
    base,
    guardYield,
    guardThrow,
  );
}

describe('instrumentTargetCode', () => {
  it('finds the class and keeps line numbers', () => {
    const src = `class Player extends Sprite {\n  update(dt) {\n    while (this.x < 10) this.x++;\n  }\n}`;
    const r = instrumentTargetCode(src, 'sprite');
    expect(r.errors).toEqual([]);
    expect(r.className).toBe('Player');
    expect(r.runSource.split('\n').length).toBe(src.split('\n').length);
    expect(r.runSource).toContain('{ __ambleGuardThrow(); this.x++; }');
  });

  it('adds yield guards to loops in generators', () => {
    const src = `class A extends Sprite { *start() { for (;;) { this.x += 1; } } }`;
    const r = instrumentTargetCode(src, 'sprite');
    expect(r.runSource).toContain('for (;;) { if (__ambleGuardYield()) yield;');
  });

  it('adds missing yield* before engine generators', () => {
    const src = `class A extends Sprite { *start() { this.wait(1); const n = this.game.ask('hi'); yield this.glideTo('mouse', 1); } }`;
    const r = instrumentTargetCode(src, 'sprite');
    expect(r.runSource).toContain('yield* this.wait(1)');
    expect(r.runSource).toContain("const n = yield* this.game.ask('hi')");
    expect(r.runSource).toContain("yield* this.glideTo('mouse', 1)");
  });

  it('turns hooks that wait into generators', () => {
    const src = `class A extends Sprite { start() { this.say('hi'); this.wait(2); this.say(''); } update(dt) { this.wait(1); } }`;
    const r = instrumentTargetCode(src, 'sprite');
    expect(r.runSource).toContain('*start()');
    expect(r.runSource).toContain('yield* this.wait(2)');
    expect(r.runSource).not.toContain('*update');
    expect(r.warnings.some((w) => w.includes('does nothing outside a generator'))).toBe(true);
    const Cls = evaluate(r.runSource, r.className!, class {});
    const inst = new Cls() as { start(): Generator; say(s: string): void; wait(n: number): Generator; said: string[] };
    inst.said = [];
    inst.say = (s: string) => inst.said.push(s);
    inst.wait = function* () {
      yield;
    };
    const gen = inst.start();
    gen.next();
    expect(inst.said).toEqual(['hi']);
    gen.next();
    expect(inst.said).toEqual(['hi', '']);
  });

  it('treats calls to the class own generator methods as needing yield*', () => {
    const src = `class A extends Sprite { *jump() { yield; } *start() { this.jump(); } }`;
    const r = instrumentTargetCode(src, 'sprite');
    expect(r.runSource).toContain('yield* this.jump()');
  });

  it('fixes the wrong base class', () => {
    const r = instrumentTargetCode(`class Level extends Sprite { start() {} }`, 'stage');
    expect(r.errors).toEqual([]);
    expect(r.runSource).toContain('class Level extends Stage');
  });

  it('renames reserved class names', () => {
    const r = instrumentTargetCode(`class Sprite extends Sprite {}`, 'sprite');
    expect(r.className).toBe('SpriteScript');
    expect(r.runSource).toContain('class SpriteScript extends Sprite');
  });

  it('reports syntax errors with a location', () => {
    const r = instrumentTargetCode(`class A extends Sprite { start() { yield 1; } }`, 'sprite');
    expect(r.errors[0]).toMatch(/^Syntax error at line 1/);
  });

  it('reports a missing class', () => {
    const r = instrumentTargetCode(`function foo() {}`, 'sprite');
    expect(r.errors[0]).toMatch(/No `class ... extends Sprite`/);
  });

  it('warns about hooks with wrong names', () => {
    const r = instrumentTargetCode(`class A extends Sprite { onKeyPress(k) {} }`, 'sprite');
    expect(r.warnings.join(' ')).toMatch(/onKeyPress\(\) is never called/);
  });
});
