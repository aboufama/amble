/**
 * Chunk groups for the app build (§10.3: the First page and the Trail load at most 350 KB of JS).
 *
 * Rolldown puts a module in a chunk by which entries reach it through static imports, before tree-shaking.
 * The core barrels (src/cores/ai.ts, src/cores/play.ts) load with the app for small things (class links,
 * the safety floor, protocol constants), and statically reach everything they re-export, so without these
 * groups the validator (acorn, magic-string), the AMBLE PATCH parser, the kit's API with its docs and the
 * Player share chunks with what the first screen needs, and load with it. With them, each is a chunk of
 * its own that only the screens and jobs using it load (nothing that boots calls into them).
 *
 * A group also takes the modules its members import, unless a group of higher priority took them first:
 * `shared` holds what both sides use (protocol constants and parsers, names, Vite's preload helper), so it
 * stays small, and the kit's API outranks the code tools that read it, so Look inside's docs load without
 * the validator.
 */
import type { Rolldown } from 'vite';

const sep = '[\\\\/]';
const src = (path: string) => new RegExp(`${sep}src${sep}${path.replace(/\//g, sep)}`);
const any = (...res: RegExp[]) => new RegExp(res.map((r) => r.source).join('|'));

const KIT_API = any(src('play/kit/(manifest|dts)\\.ts$'), /amble-kit\.d\.ts/);
const PLAYER = any(src('play/(player|frame|robot|robotJudge|standalone|bootstrap|runtimeBytes)\\.ts$'), src('cores/(player|playStandalone)\\.ts$'));
const CODE_TOOLS = any(
  new RegExp(`${sep}node_modules${sep}(acorn|acorn-walk|magic-string|@jridgewell${sep}sourcemap-codec)${sep}`),
  src('(ai/validate|ai/patch)/'),
  src('cores/aiCode\\.ts$'),
);

export const LAZY_GROUPS: Rolldown.CodeSplittingGroup[] = [
  // What both sides use: protocol v2 constants and parsers, keys, rate limits, kit names, game file names.
  {
    name: 'shared',
    test: any(src('play/(protocol|boot|keys|limits|kit/synonyms|kit/twistCatalog|kit/names)\\.ts$'), src('ai/gameFiles\\.ts$'), /vite[\\/]preload-helper/),
    priority: 10,
  },
  // The kit's API as data, with its docs (the prompt's cheat sheet, Look inside's hover docs).
  { name: 'kit-api', test: KIT_API, priority: 5 },
  // The player itself (frames, the robot test, the standalone page): it loads with the first game.
  { name: 'player', test: PLAYER, priority: 4 },
  // Reading and checking game code: the validator and acorn, the AMBLE PATCH parser, and their adapters.
  { name: 'code-tools', test: CODE_TOOLS, priority: 3 },
];

/**
 * The lazy groups' modules only define things when they load (tables, classes, functions: no globals, no
 * registration), so a barrel that re-exports them need not run them. Without this, the barrels loaded at
 * boot import each lazy chunk for its side effects, and the chunks load with the first screen anyway.
 */
export const PURE_ON_LOAD: NonNullable<Rolldown.TreeshakingOptions['moduleSideEffects']> = [KIT_API, PLAYER, CODE_TOOLS].map((test) => ({ test, sideEffects: false }));
