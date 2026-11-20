/**
 * The harness's "split" build of a new game: instead of one long reply that plans the game and then
 * writes all of its code, one after the other,
 *
 *   1. a short design request plans the game: the cast with each character's exact role, the
 *      contract between them (game vars, messages, what one calls on another) and the asset list
 *      (streamed, so the art starts as soon as the list is complete);
 *   2. then a few writers write the code at the same time, from that plan: one the game piece,
 *      the others a share of the cast each.
 *
 * The code no longer comes out of one stream, so a build takes about as long as the plan plus the
 * longest share, rather than as long as all of it. The check that follows (lint, trial run) catches
 * any seams between the writers.
 */
import { chatJson, type AiSettings, type Transport } from './openai';
import { harness } from './harness';
import type { PieceTask } from './prompt';
import { PIECES_SCHEMA, type AssetRequest, type PiecesReply } from './schema';
import { streamedTitle, watchArray } from './stream';

interface DesignSprite {
  name: string;
  description: string;
  x: number;
  y: number;
  size: number;
  direction: number;
  visible: boolean;
  role: string;
}

interface DesignReply {
  title: string;
  howToPlay: string;
  plan: string;
  assets: AssetRequest[];
  sprites: DesignSprite[];
  warnings: string[];
}

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = () => ({ type: 'number' });

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'howToPlay', 'plan', 'assets', 'sprites', 'warnings'],
  properties: {
    title: PIECES_SCHEMA.properties.title,
    howToPlay: PIECES_SCHEMA.properties.howToPlay,
    plan: str('The game as the writers will build it: its arc (acts, waves, boss, ending), the rules, every this.game.vars key with its meaning and start value, every message (name, data, who sends it, who handles it), every method or field one class uses on another, and what the game piece does versus what the characters do.'),
    assets: PIECES_SCHEMA.properties.assets,
    sprites: {
      type: 'array',
      description: 'Every character the game adds, with what its class must do.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'x', 'y', 'size', 'direction', 'visible', 'role'],
        properties: {
          name: str(),
          description: str('What it is and what it does.'),
          x: num(),
          y: num(),
          size: num(),
          direction: num(),
          visible: { type: 'boolean' },
          role: str('Exactly what its class does: its hooks and behavior, its fields, the methods and fields other code uses on it (with their names), the messages it sends and handles, and the costume and sound names it uses.'),
        },
      },
    },
    warnings: PIECES_SCHEMA.properties.warnings,
  },
} as const;

const CODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['game', 'sprites'],
  properties: {
    game: str('The body of the game piece, when you were asked for it; otherwise "".'),
    sprites: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'code'], properties: { name: str(), code: str('Its whole class: `class <Name> extends Sprite { ... }`.') } },
    },
  },
} as const;

interface CodeReply {
  game: string;
  sprites: Array<{ name: string; code: string }>;
}

function planText(d: DesignReply): string {
  const lines = [`Title: ${d.title}`, `How to play: ${d.howToPlay}`, '', d.plan.trim(), '', '### The cast'];
  for (const s of d.sprites ?? []) lines.push(`- "${s.name}" (starts at x=${s.x}, y=${s.y}, size ${s.size}%, ${s.visible ? 'visible' : 'hidden'}): ${s.description}\n  Role: ${s.role}`);
  lines.push('', '### Art and sounds (use exactly these names)');
  for (const a of d.assets ?? []) lines.push(`- ${a.kind} "${a.name}" of "${a.target}"${a.kind === 'sound' ? '' : ` (${a.width} x ${a.height})`}: ${a.description}`);
  return lines.join('\n');
}

/** Shares of the cast, about even in how much each has to write (longest roles first, then round-robin). */
function shares(sprites: DesignSprite[], n: number): DesignSprite[][] {
  const out: DesignSprite[][] = Array.from({ length: Math.max(1, Math.min(n, sprites.length)) }, () => []);
  const load = out.map(() => 0);
  for (const s of [...sprites].sort((a, b) => b.role.length - a.role.length)) {
    const i = load.indexOf(Math.min(...load));
    out[i].push(s);
    load[i] += s.role.length + 200;
  }
  return out.filter((x) => x.length);
}

export async function writeGameSplit(args: {
  game: PieceTask;
  system: string;
  /** For the characters' writers: the engine and the rules, without the notes on directing a whole game. */
  castSystem?: string;
  user: string;
  transport: Transport;
  settings: AiSettings;
  signal?: AbortSignal;
  onAssets?: (assets: AssetRequest[], title: string) => void;
  onProgress?: (message: string) => void;
}): Promise<PiecesReply> {
  const h = harness();
  let latest = '';
  const watch = args.onAssets ? watchArray('assets', (items) => args.onAssets!(items as AssetRequest[], streamedTitle(latest))) : null;
  args.onProgress?.('Planning your game');
  const design = await chatJson<DesignReply>(args.transport, {
    model: args.settings.model,
    system: args.system,
    user: `${args.user}

## How this build works
Plan the game now; the code is written next, by writers working at the same time from your plan, each without seeing the others' code. So this reply has no code: it is the plan they build from, and it must leave nothing for them to guess. Write "assets" before "sprites" (the art is made from that list while the code is written). Keep it tight, because the writers wait for it: one short sentence per asset description, and each role as a compact list. Name every this.game.vars key, every message and its data, every method or field one class uses on another, and the exact costume and sound names each character uses. The game piece (${args.game.id}) runs the game on the stage: the setup, the HUD, the spawners, the arc and the ending; the characters' own behavior lives in their classes.`,
    schema: DESIGN_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'amble_design',
    reasoningEffort: h.gameEffort ?? args.settings.reasoningEffort,
    kind: 'code',
    signal: args.signal,
    onText: watch
      ? (text) => {
          latest = text;
          watch(text);
        }
      : undefined,
  });

  const plan = planText(design);
  const cast = (design.sprites ?? []).filter((s) => String(s.name ?? '').trim());
  const groups = shares(cast, Math.max(1, h.splitWriters - 1));
  args.onProgress?.(`Writing the game in ${groups.length + 1} parts at once`);
  const write = (part: string, system = args.system) =>
    chatJson<CodeReply>(args.transport, {
      model: args.settings.model,
      system,
      user: `${args.user}\n\n## The plan (follow it exactly: other writers are writing the rest from it at the same time)\n${plan}\n\n## Your part\n${part}`,
      schema: CODE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'amble_code',
      reasoningEffort: h.writerEffort,
      kind: 'code',
      signal: args.signal,
    });
  const [gameReply, ...castReplies] = await Promise.all([
    write(`Write the game piece ${args.game.id} (the body of its method, on the stage): "game". Leave "sprites" empty.`),
    ...groups.map((g) => write(`Write the whole class of ${g.length > 1 ? 'each of these characters' : 'this character'}: ${g.map((s) => `"${s.name}"`).join(', ')}, in "sprites" (name and code). Leave "game" "".`, args.castSystem ?? args.system)),
  ]);
  const code = new Map<string, string>();
  for (const r of castReplies) for (const s of r.sprites ?? []) code.set(String(s.name ?? '').trim(), String(s.code ?? ''));
  return {
    title: design.title,
    howToPlay: design.howToPlay,
    pieces: [{ id: args.game.id, code: String(gameReply.game ?? '') }],
    sprites: cast.map((s) => ({ name: s.name, description: s.description, x: s.x, y: s.y, size: s.size, direction: s.direction, visible: s.visible, code: code.get(String(s.name).trim()) ?? '' })),
    assets: design.assets ?? [],
    warnings: design.warnings ?? [],
    questions: [],
  };
}
