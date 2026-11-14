import { dialOf, type Dial, type Freedom } from '../blocks/spec';
import { block, newProject, workspace } from './defaults';
import type { Project } from './types';

/** The name new projects start with (the compiler's name for the game replaces it). */
export const UNTITLED = 'Untitled game';

/**
 * A game as an idea: a sentence or two on the stage, the dial (how much of the game Amble makes
 * from it: a stop 0 to 4, or its level's name), and maybe a look. No sprites and no scripts: the
 * compiler makes the cast and the game (see the game piece in src/compiler/codegen.ts). Sprites
 * the author adds later join the cast.
 */
export function ideaProject(idea: string, dial: Dial | Freedom = 'go wild', style = ''): Project {
  const p = newProject();
  p.title = UNTITLED;
  p.sprites = [];
  p.variables = [];
  p.dial = typeof dial === 'number' ? dial : dialOf(dial);
  const blocks = [block('br_game', { WHAT: idea.trim() })];
  if (style.trim()) blocks.push(block('br_style', { STYLE: style.trim() }));
  p.stage.blocks = workspace(...blocks);
  return p;
}
