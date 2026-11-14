import type { Freedom } from '../blocks/spec';
import { block, newProject, workspace } from './defaults';
import type { Project } from './types';

/** The name new projects start with (the compiler's name for the game replaces it). */
export const UNTITLED = 'Untitled game';

/**
 * A game as an idea: a sentence or two on the stage, the imagination dial, and maybe a look. No
 * sprites and no scripts: the compiler makes the cast and the game (see the game piece in
 * src/compiler/codegen.ts). Sprites the author adds later join the cast.
 */
export function ideaProject(idea: string, freedom: Freedom = 'go wild', style = ''): Project {
  const p = newProject();
  p.title = UNTITLED;
  p.sprites = [];
  p.variables = [];
  const blocks = [block('br_game', { WHAT: idea.trim() }), block('br_freedom', { LEVEL: freedom })];
  if (style.trim()) blocks.push(block('br_style', { STYLE: style.trim() }));
  p.stage.blocks = workspace(...blocks);
  return p;
}
