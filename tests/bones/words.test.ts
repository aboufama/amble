/** The rig core's English labels and issue codes, in the app's own words (§2.11, §1.3). */
import { describe, expect, it } from 'vitest';
import { t } from '../../src/i18n';
import { CHARACTER_KINDS, addDynamic, clipsFor, jointList, resolveClip, templateFor, type FitIssue } from '../../src/cores/rig';
import { ISSUE_CODES, JOINT_KEYS, boneName, guessReasons, issueText, issuesFromNotes, jointName, movesFor, firstMove, moveWord, nowWord, starsOf } from '../../src/bones/words';
import { facingWord, kindPhrase, rigFacing } from '../../src/bones/kindWords';

describe('joint and bone words', () => {
  it('has words for every star of every kind (never the core English, never the fallback)', () => {
    for (const kind of CHARACTER_KINDS) {
      const rig = templateFor(kind, 200, 300);
      for (const j of jointList(rig)) {
        expect(JOINT_KEYS, `${kind}: ${j.key}`).toContain(j.key);
        const name = jointName(rig, j);
        expect(name, `${kind}: ${j.id}`).not.toBe(t('bones.jpStar'));
        expect(name[0]).toBe(name[0].toUpperCase());
      }
      rig.bones.forEach((_, i) => expect(boneName(rig, i), `${kind} bone ${i}`).toMatch(/\S/));
    }
  });

  it('names the sides the way the legend does', () => {
    const rig = templateFor('biped', 200, 300);
    const names = jointList(rig).map((j) => jointName(rig, j));
    expect(names).toContain('Left elbow');
    expect(names).toContain('Right knee');
    expect(names).toContain('Neck');
    expect(boneName(rig, rig.bones.findIndex((b) => b.role === 'armL1'))).toBe('left upper arm');
  });

  it('keeps a star\'s id and name when a wiggly bit grows out of it', () => {
    const base = templateFor('biped', 200, 300);
    const before = starsOf(base).find((s) => s.name === 'Head top')!;
    const rig = addDynamic(base, before.sid, [100, 0]);
    const after = starsOf(rig).find((s) => s.sid === before.sid)!;
    expect(after.name).toBe('Head top');
    expect(starsOf(rig).some((s) => /^Wiggly bit \d+ tip$/.test(s.name))).toBe(true);
    expect(new Set(starsOf(rig).map((s) => s.sid)).size).toBe(starsOf(rig).length);
  });

  it('numbers wiggly bits instead of giving them a side', () => {
    const base = templateFor('biped', 200, 300);
    const rig = addDynamic(base, 'head.tip', [140, 0]);
    const tip = jointList(rig).find((j) => j.id === `${rig.bones[rig.bones.length - 1].name}.tip`)!;
    expect(jointName(rig, tip)).toMatch(/^Wiggly bit \d+ tip$/);
    expect(boneName(rig, rig.bones.length - 1)).toMatch(/^wiggly bit \d+$/);
  });
});

describe("why Amble guessed", () => {
  it('has a sentence for every issue code', () => {
    const all: FitIssue[] = ['no-head', 'no-legs', 'one-leg', 'legs-merged', 'missing-arm', 'no-arms', 'few-legs', 'missing-wing', 'no-tail', 'short-body', 'hint-dropped', 'thin-strokes'];
    expect([...ISSUE_CODES].sort()).toEqual([...all].sort());
    for (const code of all) expect(issueText(code)).not.toBe(t('bones.issueUnknown'));
  });

  it("reads the core's English notes back as issue codes", () => {
    expect(issuesFromNotes(['The legs almost touch, so they looked stuck together. I split them. If a knee is in the wrong place, drag it.'])).toEqual(['legs-merged']);
    expect(issuesFromNotes(['I found one arm. Press Mirror sides to copy it to the other side.', 'I found 3 legs. Drag the joints.'])).toEqual(['missing-arm', 'few-legs']);
    expect(issuesFromNotes(['I found 2 wheels; they spin when it moves.'])).toEqual([]);
  });

  it('gives at most two reasons, the ones a student can act on first', () => {
    const r = guessReasons(['no-tail', 'no-arms', 'legs-merged'], []);
    expect(r).toEqual([issueText('legs-merged'), issueText('no-arms')]);
    expect(guessReasons([], ['I found one leg. Press Mirror sides to copy it, or drag the joints.'])).toEqual([issueText('one-leg')]);
  });
});

describe('moves, kinds and facing', () => {
  it('offers the eight moves, plus the kind\'s own, and every one plays', () => {
    for (const kind of CHARACTER_KINDS) {
      const moves = movesFor(kind);
      expect(moves).toEqual(expect.arrayContaining(['idle', 'walk', 'run', 'jump', 'fall', 'hurt', 'attack', 'wave']));
      expect(moves).toContain(firstMove(kind));
      for (const m of moves) {
        expect(resolveClip(kind, m), `${kind} ${m}`).not.toBeNull();
        expect(moveWord(m)).not.toBe(m);
        expect(nowWord(m)).not.toBe(m);
      }
    }
    expect(movesFor('flyer')[0]).toBe('fly');
    expect(movesFor('swimmer')[0]).toBe('swim');
    expect(clipsFor('biped')).toContain('walk');
  });

  it('says every kind and turns facing both ways', () => {
    for (const kind of CHARACTER_KINDS) expect(kindPhrase(kind)).toMatch(/\S/);
    expect(kindPhrase('biped')).toBe('A person');
    for (const f of ['viewer', 'right', 'left'] as const) expect(facingWord(rigFacing(f))).toBe(f);
    expect(t('bones.kindPill', { kind: kindPhrase('biped'), facing: t('bones.facingYou') })).toBe('A person, facing you');
  });
});
