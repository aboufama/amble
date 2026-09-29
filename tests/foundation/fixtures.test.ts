/**
 * The e2e AI fixtures (§8.4) are what their names say, checked with the AI core's own parser, applier and
 * validator: a valid build, a clean change, a change that throws at boss.js line 3, its fix, a bad find,
 * a truncated reply, a refusal, and a plan that passes the `amble_plan` shape.
 */
import { describe, expect, it } from 'vitest';
import { applyPatch, kitManifest, PatchParser, validateGame, type SourceFile } from '../../src/cores/ai';
import { isPlanReply } from '../../src/model/guards';

const FIXTURES = import.meta.glob<string>('/e2e/fixtures/ai/*', { query: '?raw', import: 'default', eager: true });
const fixture = (name: string) => {
  const text = FIXTURES[`/e2e/fixtures/ai/${name}`];
  if (text === undefined) throw new Error(`No fixture ${name}`);
  return text;
};

/** Parses a reply the way it streams: in 400-character chunks. */
function parse(text: string) {
  const parser = new PatchParser();
  for (let i = 0; i < text.length; i += 400) parser.feed(text.slice(i, i + 400));
  return parser.end();
}

function apply(files: SourceFile[], name: string) {
  const patch = parse(fixture(name));
  return { patch, result: applyPatch(files, patch.ops) };
}

const errorsOf = (files: SourceFile[]) => validateGame(files, { manifest: kitManifest(), fix: false }).errors;

describe('e2e AI fixtures', () => {
  const built = apply([], 'build-moon-king.patch').result.files;

  it('has every fixture the spec lists', () => {
    expect(Object.keys(FIXTURES).map((p) => p.split('/').pop()).sort()).toEqual(
      ['bad-find.patch', 'build-moon-king.patch', 'change-stomp.patch', 'change-throws.patch', 'fix-ok.patch', 'plan-snail.json', 'refused.patch', 'truncated.patch'],
    );
  });

  it('plan-snail.json is an amble_plan reply', () => {
    const plan = JSON.parse(fixture('plan-snail.json'));
    expect(isPlanReply(plan)).toBe(true);
    expect(plan.cast[0].key).toBe('hero');
  });

  it('build-moon-king.patch builds a valid kit game', () => {
    const { patch, result } = apply([], 'build-moon-king.patch');
    expect(patch).toMatchObject({ complete: true, truncatedIn: null, safety: { status: 'ok' } });
    expect(patch.next).toHaveLength(3);
    expect(result.failures).toEqual([]);
    expect(result.files.map((f) => f.path)).toEqual(['game.js']);
    expect(errorsOf(result.files)).toEqual([]);
    const art = validateGame(result.files, { manifest: kitManifest(), fix: false }).art.declared;
    expect(art).toEqual(expect.arrayContaining(['hero', 'moonKing', 'grumble', 'orb']));
  });

  it('change-stomp.patch edits the game cleanly', () => {
    const { result } = apply(built, 'change-stomp.patch');
    expect(result.failures).toEqual([]);
    expect(result.changed).toEqual(['game.js']);
    expect(result.files[0].content).toContain('dash: true, stomp: true');
    expect(errorsOf(result.files)).toEqual([]);
  });

  it('change-throws.patch validates but throws at boss.js line 3 in update', () => {
    const { result } = apply(built, 'change-throws.patch');
    expect(result.failures).toEqual([]);
    expect(result.created).toEqual(['boss.js']);
    expect(errorsOf(result.files)).toEqual([]);
    const boss = result.files.find((f) => f.path === 'boss.js')!;
    expect(boss.content.split('\n')[2]).toBe('  const power = boss.stompPower.amount;');
    const game = result.files.find((f) => f.path === 'game.js')!;
    expect(game.content).toContain('moonKingStomp(this, b);');
  });

  it('fix-ok.patch repairs it', () => {
    const broken = apply(built, 'change-throws.patch').result.files;
    const { result } = apply(broken, 'fix-ok.patch');
    expect(result.failures).toEqual([]);
    expect(errorsOf(result.files)).toEqual([]);
    expect(result.files.find((f) => f.path === 'boss.js')!.content).toContain('boss.stompPower ? boss.stompPower.amount : 4');
  });

  it('bad-find.patch does not match the file', () => {
    const { result } = apply(built, 'bad-find.patch');
    expect(result.failures.map((f) => f.path)).toEqual(['game.js']);
  });

  it('truncated.patch stops inside game.js with no @@end', () => {
    const patch = parse(fixture('truncated.patch'));
    expect(patch.complete).toBe(false);
    expect(patch.truncatedIn).toBe('game.js');
    expect(patch.ops).toEqual([]);
  });

  it('refused.patch refuses and carries no files', () => {
    const patch = parse(fixture('refused.patch'));
    expect(patch.safety.status).toBe('refused');
    expect(patch.safety.note).toMatch(/real people/);
    expect(patch.ops).toEqual([]);
  });
});
