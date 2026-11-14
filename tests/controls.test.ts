import { describe, expect, it } from 'vitest';
import { FREEDOM_LEVELS, dialOf, freedomOf, type Dial, type Freedom } from '../src/blocks/spec';
import { planTarget, projectFreedom } from '../src/compiler/codegen';
import { compileNeedsRequest, inputHash } from '../src/compiler/compile';
import { classNames, piecesSystemPrompt, piecesUserPrompt } from '../src/compiler/prompt';
import { isDisabled, serializeBlocks, topBlocks } from '../src/compiler/serialize';
import { DEFAULT_DIAL, DIAL_STOPS, applyDial, projectDial, projectIdea, projectStyle, withStyle } from '../src/project/controls';
import { block, newProject, workspace } from '../src/project/defaults';
import { ideaProject } from '../src/project/idea';
import { STYLE_PRESETS, presetOf } from '../src/project/styles';
import type { Project } from '../src/project/types';

const plansOf = (p: Project) => {
  const names = classNames(p);
  return [p.stage, ...p.sprites].map((t) => planTarget(p, t, names.get(t.id)!));
};
const piecesOf = (p: Project) => plansOf(p).flatMap((plan) => plan.pieces);
const gamePiece = (p: Project) => piecesOf(p).find((r) => r.kind === 'game');
const stageText = (p: Project) => serializeBlocks(p.stage.blocks).text.split('\n');
const DIALS: Dial[] = [0, 1, 2, 3, 4];

/** A project from before the dial: its level is an imagination: block on the stage. */
function oldProject(level: string, idea = 'a cat delivers pizza'): Project {
  const p = newProject();
  p.sprites = [];
  p.stage.blocks = workspace(block('br_game', { WHAT: idea }), block('br_freedom', { LEVEL: level }));
  return p;
}

describe('the five stops of the dial', () => {
  it('are the five levels in order, the three from before among them', () => {
    expect([...FREEDOM_LEVELS]).toEqual(['just what I say', 'small', 'fill in the gaps', 'go wild', 'grand']);
    expect(DIAL_STOPS.map((s) => [s.dial, s.freedom, s.label])).toEqual([
      [0, 'just what I say', 'My blocks'],
      [1, 'small', 'Small'],
      [2, 'fill in the gaps', 'Full'],
      [3, 'go wild', 'Wild'],
      [4, 'grand', 'Grand'],
    ]);
    for (const s of DIAL_STOPS) expect(s.hint.length, s.label).toBeGreaterThan(20);
    expect(DEFAULT_DIAL).toBe(3);
  });

  it('map to the levels and back', () => {
    for (const dial of DIALS) {
      expect(freedomOf(dial)).toBe(FREEDOM_LEVELS[dial]);
      expect(dialOf(freedomOf(dial))).toBe(dial);
    }
    for (const level of FREEDOM_LEVELS) expect(freedomOf(dialOf(level))).toBe(level);
    expect([dialOf('just what I say'), dialOf('fill in the gaps'), dialOf('go wild')]).toEqual([0, 2, 3]);
    // Anything that isn't a stop is "My blocks".
    expect([freedomOf(undefined), freedomOf(7), freedomOf(-1), freedomOf(1.5)]).toEqual(Array(4).fill('just what I say'));
    expect(dialOf('nonsense' as Freedom)).toBe(0);
  });
});

describe("the project's dial", () => {
  it('is what a new idea is made with, and there is no imagination: block any more', () => {
    for (const dial of DIALS) {
      const p = ideaProject('a cat delivers pizza', dial);
      expect(p.dial).toBe(dial);
      expect(projectDial(p)).toBe(dial);
      expect(projectFreedom(p)).toBe(FREEDOM_LEVELS[dial]);
      expect(stageText(p)).toEqual(['game: [a cat delivers pizza]']);
    }
    // By name too, and "Wild" when nothing is said.
    expect(ideaProject('a cat delivers pizza', 'grand').dial).toBe(4);
    expect(ideaProject('a cat delivers pizza').dial).toBe(3);
    expect(stageText(ideaProject('a cat delivers pizza', 2, 'pixel art'))).toEqual(['game: [a cat delivers pizza]', 'art style: [pixel art]']);
  });

  it('is "My blocks" in a project with neither a dial nor the block', () => {
    const p = newProject();
    expect(p.dial).toBeUndefined();
    expect(projectDial(p)).toBe(0);
    expect(projectFreedom(p)).toBe('just what I say');
    expect(piecesOf(p)).toEqual([]);
  });

  it('makes the game: line the whole game from "Small" up, and only says what the game is about on "My blocks"', () => {
    expect(piecesOf(ideaProject('a cat delivers pizza', 0))).toEqual([]);
    expect(compileNeedsRequest(ideaProject('a cat delivers pizza', 0))).toBe(false);
    for (const dial of [1, 2, 3, 4] as Dial[]) {
      const p = ideaProject('a cat delivers pizza', dial);
      expect(piecesOf(p).map((r) => [r.kind, r.words, r.freedom])).toEqual([['game', 'a cat delivers pizza', FREEDOM_LEVELS[dial]]]);
      expect(compileNeedsRequest(p)).toBe(true);
      expect(plansOf(p).flatMap((plan) => plan.warnings)).toEqual([]);
    }
  });

  it('gives the game piece another key at every stop, and the game needs building again', () => {
    const keys = DIALS.map((dial) => gamePiece(ideaProject('a cat delivers pizza', dial))?.key);
    expect(keys[0]).toBeUndefined();
    expect(new Set(keys.slice(1)).size).toBe(4);
    // The same stop and sentence: the same piece (so moving the dial back keeps the game that's there).
    expect(gamePiece(ideaProject('a cat delivers pizza', 4))!.key).toBe(keys[4]);

    const p = ideaProject('a cat delivers pizza', 2);
    const hashes = DIALS.map((dial) => inputHash({ ...p, dial }));
    expect(new Set(hashes).size).toBe(5);
    expect(inputHash({ ...p, dial: 2 })).toBe(hashes[2]);
    // A game built at one stop is stale at another, and needs a request for the new game piece.
    const built = { ...p, compiled: { inputHash: hashes[2], pieces: [{ key: keys[2]!, kind: 'game', target: 'Stage', block: '', code: '' }], brief: 'game: [a cat delivers pizza]\nimagination: [fill in the gaps ▾]' } } as unknown as Project;
    expect(compileNeedsRequest(built)).toBe(false);
    expect(inputHash({ ...built, dial: 4 })).not.toBe(built.compiled!.inputHash);
    expect(compileNeedsRequest({ ...built, dial: 4 })).toBe(true);
  });

  it('is part of the brief, so everything written for the game is looked at again when it moves', () => {
    expect(DIALS.map((dial) => plansOf(ideaProject('a cat delivers pizza', dial, 'neon'))[0].brief)).toEqual([
      ['game: [a cat delivers pizza]', 'art style: [neon]'],
      ['game: [a cat delivers pizza]', 'imagination: [small ▾]', 'art style: [neon]'],
      ['game: [a cat delivers pizza]', 'imagination: [fill in the gaps ▾]', 'art style: [neon]'],
      ['game: [a cat delivers pizza]', 'imagination: [go wild ▾]', 'art style: [neon]'],
      ['game: [a cat delivers pizza]', 'imagination: [grand ▾]', 'art style: [neon]'],
    ]);
    // Nothing for the dial to make a game from: nothing in the brief.
    expect(plansOf({ ...newProject(), dial: 4, stage: { ...newProject().stage, blocks: workspace(block('br_audience', { WHO: 'kids' })) } })[0].brief).toEqual(['made for: [kids]']);
  });

  it('leaves the hash of a project from before the dial as it was', () => {
    const p = newProject();
    const { dial: _none, ...before } = { ...p, dial: undefined };
    void _none;
    expect(inputHash(p)).toBe(inputHash(before as Project));
    expect(inputHash({ ...p, dial: 0 })).not.toBe(inputHash(p));
  });
});

describe('a project from before the dial', () => {
  it('still says its level with the imagination: block', () => {
    expect(projectDial(oldProject('just what I say'))).toBe(0);
    expect(projectDial(oldProject('fill in the gaps'))).toBe(2);
    expect(projectDial(oldProject('go wild'))).toBe(3);
    // The block's menu has the new levels too, and words it doesn't know mean "fill in the gaps", as before.
    expect(projectDial(oldProject('small'))).toBe(1);
    expect(projectDial(oldProject('grand'))).toBe(4);
    expect(projectFreedom(oldProject('as you like'))).toBe('fill in the gaps');
    // A block that is switched off says nothing.
    const off = oldProject('go wild');
    (topBlocks(off.stage.blocks)[1] as { enabled?: boolean }).enabled = false;
    expect(projectDial(off)).toBe(0);
  });

  it('builds the same game piece as the same stop on the dial, with the block in its brief', () => {
    const old = oldProject('go wild');
    expect(gamePiece(old)!.freedom).toBe('go wild');
    expect(gamePiece(old)!.key).toBe(gamePiece(ideaProject('a cat delivers pizza', 3))!.key);
    expect(plansOf(old)[0].brief).toEqual(['game: [a cat delivers pizza]', 'imagination: [go wild ▾]']);
    expect(plansOf(old)[0].brief).toEqual(plansOf(ideaProject('a cat delivers pizza', 3))[0].brief);
    expect(plansOf(old)[0].warnings).toEqual([]);
    expect(piecesOf(oldProject('just what I say'))).toEqual([]);
  });

  it('keeps the game it built when the dial is moved and moved back', () => {
    const old = oldProject('go wild');
    const built = { ...old, compiled: { inputHash: inputHash(old), pieces: [{ key: gamePiece(old)!.key, kind: 'game', target: 'Stage', block: '', code: '' }], brief: plansOf(old)[0].brief.join('\n') } } as unknown as Project;
    expect(compileNeedsRequest(built)).toBe(false);
    applyDial(built, 4);
    expect(compileNeedsRequest(built)).toBe(true);
    // Back on "Wild": the block is gone and the dial says it, and it is the same game (the flag plays it with no request).
    applyDial(built, 3);
    expect(stageText(built)).toEqual(['game: [a cat delivers pizza]']);
    expect(compileNeedsRequest(built)).toBe(false);
  });

  it('follows the dial once it is set: the dial wins, and the block goes', () => {
    const p = oldProject('go wild');
    p.sprites = [{ ...newProject().sprites[0], blocks: workspace(block('br_freedom', { LEVEL: 'fill in the gaps' }), [block('ev_start'), block('kit_gravity')]) }];
    // (Set but with the block still there, as in a file edited by hand: the dial wins, and the block says it isn't used.)
    const both: Project = { ...p, dial: 1 };
    expect(projectDial(both)).toBe(1);
    expect(gamePiece(both)!.freedom).toBe('small');
    expect(plansOf(both)[0].brief).toEqual(['game: [a cat delivers pizza]', 'imagination: [small ▾]']);
    expect(plansOf(both)[0].warnings.join(' ')).toContain("isn't used any more");

    applyDial(p, 4);
    expect(p.dial).toBe(4);
    expect(stageText(p)).toEqual(['game: [a cat delivers pizza]']);
    expect(topBlocks(p.sprites[0].blocks).map((b) => b.type)).toEqual(['ev_start']);
    expect(gamePiece(p)!.freedom).toBe('grand');
    expect(plansOf(p).flatMap((plan) => plan.warnings)).toEqual([]);
  });
});

describe('the compile request at each stop', () => {
  const plain = piecesSystemPrompt('2d');
  const at = (dial: Dial) => piecesSystemPrompt('2d', { freedom: freedomOf(dial) });
  const section = (dial: Dial) => at(dial).slice(at(dial).indexOf('## How much to invent'));

  it('has the directing notes and one section on how much to invent, from "Small" up', () => {
    expect(at(0)).toBe(plain);
    for (const dial of [1, 2, 3, 4] as Dial[]) {
      const prompt = at(dial);
      expect(prompt.startsWith(plain)).toBe(true);
      expect(prompt).toContain('# Directing a game');
      expect(prompt.match(/^## How much to invent: (.*)$/gm)).toEqual([`## How much to invent: ${FREEDOM_LEVELS[dial]}`]);
      // The section comes last, so what it says about size is the last word.
      expect(prompt.endsWith(section(dial))).toBe(true);
      expect(section(dial)).toMatch(/^Size\b.*: a cast of \d+ to \d+ characters; .*a full play lasts .*; \d+ to \d+ images.*; .*sounds/m);
    }
    expect(new Set([1, 2, 3, 4].map((d) => section(d as Dial))).size).toBe(4);
  });

  it('invents more at every stop', () => {
    expect(section(1)).toContain('small, simple game');
    expect(section(1)).toContain('Invent only what that needs to work');
    expect(section(2)).toContain("No mechanics, characters or twists they didn't ask for");
    for (const dial of [1, 2] as Dial[]) expect(section(dial)).not.toContain('somewhere they didn\'t see coming');
    for (const dial of [3, 4] as Dial[]) expect(section(dial)).toContain("somewhere they didn't see coming");
    expect(section(3)).toContain('The author wants to be amazed');
    // Only the grand game has it all: an opening, several acts, a boss in phases, an ending.
    for (const words of ['An opening', 'Three to five acts or levels', 'three phases', 'An ending', 'four to six minutes']) {
      expect(section(4)).toContain(words);
      for (const dial of [1, 2, 3] as Dial[]) expect(section(dial)).not.toContain(words);
    }
  });

  it('is a little bigger at every stop: the cast, the acts, the length, the pictures and the sounds', () => {
    const size = (dial: Dial) => {
      const line = section(dial).split('\n').find((l) => l.startsWith('Size'))!;
      const range = (re: RegExp) => re.exec(line)!.slice(1, 3).map(Number);
      return { cast: range(/cast of (\d+) to (\d+)/), images: range(/(\d+) to (\d+) images/), sounds: range(/(\d+) to (\d+) sounds/), line };
    };
    const sizes = ([1, 2, 3, 4] as Dial[]).map(size);
    for (let i = 1; i < sizes.length; i++) {
      for (const key of ['cast', 'images', 'sounds'] as const) {
        expect(sizes[i][key][0], `${key} at stop ${i + 1}`).toBeGreaterThan(sizes[i - 1][key][0]);
        expect(sizes[i][key][1], `${key} at stop ${i + 1}`).toBeGreaterThan(sizes[i - 1][key][1]);
      }
    }
    expect(sizes.map((s) => /a full play lasts ([^;]+);/.exec(s.line)![1])).toEqual(['about a minute', 'two to three minutes', 'about three minutes', 'four to six minutes']);
    expect(sizes[0].line).toContain('one scene, no acts and no boss');
    expect(sizes[1].line).toContain('one world');
    expect(sizes[2].line).toContain('two or three acts and a boss');
    expect(sizes[3].line).toContain('3 to 5 acts, with an opening and an ending');
    // Smaller and bigger than the directing notes: those two say which wins.
    expect(sizes[0].line).toContain('where the notes above ask for more, this wins');
    expect(sizes[3].line).toContain('where the notes above ask for less, this wins');
  });

  it('names the level on the game piece', () => {
    for (const dial of [1, 2, 3, 4] as Dial[]) {
      const p = ideaProject('a cat delivers pizza', dial);
      const plans = plansOf(p);
      const tasks = plans.flatMap((plan) => plan.pieces).map((request, i) => ({ id: `p${i + 1}`, request }));
      const prompt = piecesUserPrompt({ project: p, plans, tasks, written: new Map() });
      expect(prompt).toContain(`- p1: game (the whole game; imagination: ${FREEDOM_LEVELS[dial]}), in "Stage"`);
    }
  });
});

describe('the style knob', () => {
  const styleBlocks = (p: Project) => topBlocks(p.stage.blocks).filter((b) => b.type === 'br_style');
  const set = (p: Project, words: string): Project => ({ ...p, stage: { ...p.stage, blocks: withStyle(p.stage.blocks, words) } });

  it("reads the stage's art style: block", () => {
    expect(projectStyle(newProject())).toBe('');
    expect(projectStyle(ideaProject('a cat delivers pizza', 3))).toBe('');
    expect(projectStyle(ideaProject('a cat delivers pizza', 3, '  pixel art '))).toBe('pixel art');
    // A sprite's block isn't the project's style, and neither is one that is switched off.
    const p = newProject();
    p.sprites[0].blocks = workspace(block('br_style', { STYLE: 'neon' }));
    expect(projectStyle(p)).toBe('');
    p.stage.blocks = workspace(block('br_game', { WHAT: 'a game' }), { ...block('br_style', { STYLE: 'clay' }), enabled: false } as never, block('br_style', { STYLE: 'paper' }));
    expect(projectStyle(p)).toBe('paper');
  });

  it('a preset sets the block to its words, adding the block when the stage has none', () => {
    for (const preset of STYLE_PRESETS) {
      const p = set(ideaProject('a cat delivers pizza', 3), preset.words);
      expect(stageText(p)).toEqual(['game: [a cat delivers pizza]', `art style: [${preset.words}]`]);
      expect(projectStyle(p)).toBe(preset.words);
      expect(presetOf(projectStyle(p))).toBe(preset);
    }
    // The block there is changed where it is (the same block, nothing else moves).
    const before = ideaProject('a cat delivers pizza', 3, 'like a comic book');
    const [, was] = topBlocks(before.stage.blocks);
    const after = set(before, STYLE_PRESETS[1].words);
    expect(topBlocks(after.stage.blocks).map((b) => [b.type, b.id])).toEqual(topBlocks(before.stage.blocks).map((b) => [b.type, b.id]));
    expect(styleBlocks(after)[0]).toMatchObject({ id: was.id, fields: { STYLE: STYLE_PRESETS[1].words } });
    // (The project given isn't changed.)
    expect(projectStyle(before)).toBe('like a comic book');
  });

  it('a new block goes below the others, and builds as one typed in would', () => {
    const p = newProject();
    const tops = topBlocks(p.stage.blocks) as Array<{ y?: number }>;
    const after = set(p, 'pixel art');
    const added = topBlocks(after.stage.blocks).at(-1) as { type: string; x?: number; y?: number; id?: string };
    expect(added).toMatchObject({ type: 'br_style', x: 24 });
    expect(added.id).toBeTruthy();
    expect(added.y!).toBeGreaterThan(Math.max(...tops.map((b) => b.y ?? 0)));
    expect(piecesOf(after).map((r) => [r.kind, r.words])).toEqual([['rule', 'pixel art']]);
    // On a stage with no blocks at all, too.
    const empty = set({ ...p, stage: { ...p.stage, blocks: null } }, 'pixel art');
    expect(stageText(empty)).toEqual(['art style: [pixel art]']);
  });

  it('custom words go in as they are', () => {
    const words = 'Pixel Art, but SPOOKY: like an old Game Boy (4 greens)';
    const p = set(ideaProject('a cat delivers pizza', 3, STYLE_PRESETS[0].words), `  ${words}  `);
    expect(styleBlocks(p)).toHaveLength(1);
    expect(styleBlocks(p)[0].fields).toEqual({ STYLE: words });
    expect(projectStyle(p)).toBe(words);
    expect(presetOf(words)).toBeNull();
  });

  it('none takes the block away, and leaves everything else', () => {
    const p = ideaProject('a cat delivers pizza', 3, 'pixel art');
    const none = set(p, '');
    expect(stageText(none)).toEqual(['game: [a cat delivers pizza]']);
    expect(projectStyle(none)).toBe('');
    expect(topBlocks(none.stage.blocks)[0]).toBe(topBlocks(p.stage.blocks)[0]);
    // Every art style: block on the stage goes, except one that is switched off.
    const many = newProject();
    many.stage.blocks = workspace(block('br_style', { STYLE: 'neon' }), block('br_game', { WHAT: 'a game' }), block('br_style', { STYLE: 'clay' }), { ...block('br_style', { STYLE: 'paper' }), enabled: false } as never);
    const left = topBlocks(set(many, '   ').stage.blocks);
    expect(left.map((b) => [b.type, isDisabled(b)])).toEqual([
      ['br_game', false],
      ['br_style', true],
    ]);
    // Nothing to take away: the same blocks.
    expect(withStyle(none.stage.blocks, '')).toBe(none.stage.blocks);
  });

  it('changes what the build makes: the style is in the brief, and the game needs building', () => {
    const p = ideaProject('a cat delivers pizza', 3);
    const pixel = set(p, STYLE_PRESETS[1].words);
    expect(plansOf(pixel)[0].brief).toEqual(['game: [a cat delivers pizza]', 'imagination: [go wild ▾]', `art style: [${STYLE_PRESETS[1].words}]`]);
    expect(inputHash(pixel)).not.toBe(inputHash(p));
    expect(inputHash(set(pixel, ''))).toBe(inputHash(p));
    // The game piece is the same one: the look is its own piece.
    expect(gamePiece(pixel)!.key).toBe(gamePiece(p)!.key);
  });
});

describe('the idea of a project', () => {
  it("is the words of the stage's game: line", () => {
    expect(projectIdea(ideaProject(' a cat delivers pizza ', 3))).toBe('a cat delivers pizza');
    expect(projectIdea(newProject())).toBe('Amble explores a little world');
    const none = newProject();
    none.stage.blocks = workspace(block('br_game', { WHAT: '  ' }), block('br_audience', { WHO: 'kids' }));
    expect(projectIdea(none)).toBe('');
  });
});
