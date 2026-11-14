/**
 * The two controls that are always there, in the top bar and on the home screen, and what each
 * reads and writes in a project:
 * - the dial: how much of the game Amble makes from the stage's `game:` line (`project.dial`), and
 * - the style knob: the words of the stage's `art style:` block (a preset's, or the author's own).
 * No store and no Blockly here: src/actions.ts applies these to the open project and the editor.
 */
import { dialOf, type Dial, type Freedom } from '../blocks/spec';
import { projectFreedom } from '../compiler/codegen';
import { isDisabled, oneLine, topBlocks, type JsonBlock as SavedBlock } from '../compiler/serialize';
import { block, type JsonBlock } from './defaults';
import type { BlocksState, Project } from './types';

// -----------------------------------------------------------------------------
// The dial
// -----------------------------------------------------------------------------

export interface DialStop {
  dial: Dial;
  /** The level's name in the compiler (FREEDOM_LEVELS in src/blocks/spec.ts). */
  freedom: Freedom;
  /** Shown on the dial. */
  label: string;
  /** What the stop means, in a sentence (shown on hover). */
  hint: string;
}

/** The dial's five stops, 0 to 4. */
export const DIAL_STOPS: readonly DialStop[] = [
  { dial: 0, freedom: 'just what I say', label: 'My blocks', hint: 'Amble invents nothing: the game: line only says what the game is about, and your blocks are the game.' },
  { dial: 1, freedom: 'small', label: 'Small', hint: 'A small, simple game: only what your idea needs.' },
  { dial: 2, freedom: 'fill in the gaps', label: 'Full', hint: 'The complete, polished game your idea describes, and nothing you didn’t ask for.' },
  { dial: 3, freedom: 'go wild', label: 'Wild', hint: 'Your whole idea, plus surprises of Amble’s own: twists, acts, a boss.' },
  { dial: 4, freedom: 'grand', label: 'Grand', hint: 'The most: a grand game in several acts that each look different, with a boss in phases, an opening and an ending. Four to six minutes of play.' },
];

/** Where the dial starts for a new idea. */
export const DEFAULT_DIAL: Dial = 3;

/** Where the project's dial stands (for projects from before the dial, what their `imagination:` block says). */
export function projectDial(project: Project): Dial {
  return dialOf(projectFreedom(project));
}

/** The idea the game is made from: the words of the stage's `game:` line ('' when it has none). */
export function projectIdea(project: Project): string {
  for (const b of topBlocks(project.stage.blocks)) if (b.type === 'br_game' && !isDisabled(b) && oneLine(b.fields?.WHAT)) return oneLine(b.fields?.WHAT);
  return '';
}

const withTops = (state: BlocksState | null, tops: JsonBlock[]): BlocksState => ({ ...(state ?? {}), blocks: { ...((state?.blocks as object | undefined) ?? { languageVersion: 0 }), blocks: tops } });

/** These blocks with one more standalone block, below the others (their saved positions; a rough height per block is enough). */
export function withBlockBelow(state: BlocksState | null, added: JsonBlock): BlocksState {
  const tops = topBlocks(state) as JsonBlock[];
  const bottom = tops.reduce((y, b) => Math.max(y, (b.y ?? 0) + 60), 0);
  return withTops(state, [...tops, { ...added, x: 24, y: bottom + 28 }]);
}

/** These blocks without their `imagination:` blocks, which the dial replaced (the same blocks when there are none). */
export function withoutFreedomBlocks(state: BlocksState | null): BlocksState | null {
  const tops = topBlocks(state) as JsonBlock[];
  const kept = tops.filter((b) => b.type !== 'br_freedom');
  return kept.length === tops.length ? state : withTops(state, kept);
}

/**
 * Sets the project's dial (changing the project given). Any `imagination:` block it still has from
 * before the dial goes, so that nothing on screen says otherwise.
 */
export function applyDial(project: Project, dial: Dial): void {
  project.dial = dial;
  for (const t of [project.stage, ...project.sprites]) {
    const blocks = withoutFreedomBlocks(t.blocks);
    if (blocks !== t.blocks) t.blocks = blocks;
  }
}

// -----------------------------------------------------------------------------
// The style knob
// -----------------------------------------------------------------------------

const isStyleBlock = (b: SavedBlock) => b.type === 'br_style' && !isDisabled(b);

/** The project's art style: the words of the stage's `art style:` block ('' when it has none). */
export function projectStyle(project: Project): string {
  const b = topBlocks(project.stage.blocks).find(isStyleBlock);
  return String(b?.fields?.STYLE ?? '').trim();
}

/**
 * The stage's blocks with the art style set to these words: its `art style:` block gets them as
 * they are (a new block below the others when the stage has none), and no words takes the block away.
 */
export function withStyle(state: BlocksState | null, words: string): BlocksState | null {
  const text = words.trim();
  const tops = topBlocks(state) as JsonBlock[];
  const at = tops.findIndex(isStyleBlock);
  if (!text) return at < 0 ? state : withTops(state, tops.filter((b) => !isStyleBlock(b)));
  if (at < 0) return withBlockBelow(state, block('br_style', { STYLE: text }));
  return withTops(state, tops.map((b, i) => (i === at ? { ...b, fields: { ...b.fields, STYLE: text } } : b)));
}
