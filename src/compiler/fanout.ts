/**
 * The harness's "fan-out" build of a new game (`fanout`): one short outline, streamed, and everything
 * else started from it while it is still being written.
 *
 *   1. The outline: the title and how to play, the plan (the game's arc and the contract between its
 *      parts: game vars, messages, what one class uses on another), the sounds, the backdrops, and
 *      the cast, each character with its costumes and its role. No code.
 *   2. While it streams:
 *      - each backdrop and each character's costumes are drawn as soon as its entry is complete;
 *      - the game piece (the stage: setup, HUD, spawners, arc, ending) is written as soon as the plan,
 *        sounds and backdrops are (the stage directs the characters by the contract, not their code);
 *      - each character's class is written as soon as its entry is (a character that builds on
 *        another, `class Sprinter extends Hen`, is written with it, by the same writer).
 *
 * A one-reply build writes the asset list, then the stage, then each character, one after the other;
 * here a build takes about as long as the outline up to the cast, plus its longest part.
 */
import { chatJson, type AiSettings, type Transport } from './openai';
import { harness } from './harness';
import type { PieceTask } from './prompt';
import { PIECES_SCHEMA, type AssetRequest, type PiecesReply } from './schema';
import { watchReply } from './stream';

interface OutlineCostume {
  name: string;
  description: string;
  width: number;
  height: number;
}

interface OutlineSprite {
  name: string;
  base: string;
  description: string;
  x: number;
  y: number;
  size: number;
  direction: number;
  visible: boolean;
  costumes: OutlineCostume[];
  role: string;
}

interface Outline {
  title: string;
  howToPlay: string;
  plan: string;
  sounds: Array<{ name: string; description: string }>;
  backdrops: Array<{ name: string; description: string }>;
  cast: OutlineSprite[];
  warnings: string[];
}

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = () => ({ type: 'number' });
const named = (description: string) => ({
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: str(), description: str(description) } },
});

/** Field order is the order the build needs them in (models write "required" or "properties" order: both say this). */
const OUTLINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'howToPlay', 'plan', 'sounds', 'backdrops', 'cast', 'warnings'],
  properties: {
    title: PIECES_SCHEMA.properties.title,
    howToPlay: PIECES_SCHEMA.properties.howToPlay,
    plan: str('The game as the writers build it, in compact lines: the arc, the rules and numbers, and the contract between its parts.'),
    sounds: named('One short phrase: what makes the sound and how it feels; music starts with "music:", a short win or loss tune with "jingle:".'),
    backdrops: named('One short sentence: what the backdrop shows.'),
    cast: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'base', 'description', 'x', 'y', 'size', 'direction', 'visible', 'costumes', 'role'],
        properties: {
          name: str('A name that is also its class name (letters only, e.g. "Hen").'),
          base: str('The character whose class this one extends, or "".'),
          description: str('What it is and what it does, in one sentence.'),
          x: num(),
          y: num(),
          size: num(),
          direction: num(),
          visible: { type: 'boolean' },
          costumes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'description', 'width', 'height'],
              properties: { name: str(), description: str('One short sentence: the same character in each frame, only the pose changes.'), width: num(), height: num() },
            },
          },
          role: str('Exactly what its class does, compactly: hooks and behavior, its fields and methods others use (with names), messages it sends and handles, costume and sound names it uses.'),
        },
      },
    },
    warnings: PIECES_SCHEMA.properties.warnings,
  },
} as const;

const GAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: { code: str('The body of the game piece method (no signature, no braces around it).') },
} as const;

const CAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sprites'],
  properties: {
    sprites: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'code'], properties: { name: str(), code: str('Its whole class.') } },
    },
  },
} as const;

const GUIDE = `## How this build works
Plan the game now: this reply has no code. While you write it, the build starts on your plan: each character's drawings as soon as its entry is complete, the game piece as soon as "backdrops" is written, and each character's class as soon as its entry is. Several writers write that code at the same time from your plan alone, without seeing each other's code. So the plan must leave nothing to guess, and it must be quick to write:
- "plan": compact lines. The arc (acts or waves, twists, the boss, the ending) with its numbers. The contract: every this.game.vars key (meaning, start value), every message (name, data, who sends it, who handles it), every method or field one class uses on another. Name every character of the cast, and say what the game piece does (the setup, the HUD, spawning, the arc, the ending) and what the characters do themselves.
- "sounds", then "backdrops": everything the game plays, and the stage's backdrops.
- "cast": the player first, then the others; a kind of another character (a faster or bigger one, the boss of its kind) comes right after that character, with "base" set to it, and builds on its class. Each entry's costumes are drawn from it: frames of one character, one short sentence each. "role" is what its writer works from: hooks and behavior, the fields and methods others use, messages, the costume and sound names it uses.
Every name you give (vars, messages, methods, costumes, sounds) is the name the code uses.`;

function planText(o: Partial<Outline>, upTo: 'backdrops' | 'cast'): string {
  const lines = [`Title: ${o.title ?? ''}`, `How to play: ${o.howToPlay ?? ''}`, '', String(o.plan ?? '').trim(), '', '### Sounds (any target can play these)'];
  for (const s of o.sounds ?? []) lines.push(`- "${s.name}": ${s.description}`);
  lines.push('', '### Backdrops');
  for (const b of o.backdrops ?? []) lines.push(`- "${b.name}": ${b.description}`);
  if (upTo === 'cast') {
    lines.push('', '### The cast');
    for (const s of o.cast ?? []) lines.push(castLine(s));
  }
  return lines.join('\n');
}

function castLine(s: OutlineSprite): string {
  return `- "${s.name}"${s.base ? ` (extends ${s.base})` : ''}, starts at x=${s.x}, y=${s.y}, size ${s.size}%, ${s.visible ? 'visible' : 'hidden'}: ${s.description}\n  Costumes: ${(s.costumes ?? []).map((c) => `"${c.name}"`).join(', ') || 'none'}\n  Role: ${s.role}`;
}

const clean = (s: unknown) => String(s ?? '').trim();

export async function writeGameFanout(args: {
  game: PieceTask;
  system: string;
  user: string;
  transport: Transport;
  settings: AiSettings;
  signal?: AbortSignal;
  /** Art and sounds to make now (called several times: as each part of the outline is complete). */
  onAssets?: (assets: AssetRequest[], title: string) => void;
  /** The title and how to play, as soon as they are written (for the screen to show while the rest is made). */
  onOutline?: (o: { title?: string; howToPlay?: string }) => void;
  onProgress?: (message: string) => void;
}): Promise<PiecesReply> {
  const h = harness();
  const o: Partial<Outline> = {};
  const cast: OutlineSprite[] = [];
  const writers: Array<Promise<Array<{ name: string; code: string }>>> = [];
  let game: Promise<string> | null = null;
  let failure: unknown = null;
  const ask = <T>(user: string, schema: object, schemaName: string) =>
    chatJson<T>(args.transport, {
      model: args.settings.model,
      system: args.system,
      user,
      schema: schema as Record<string, unknown>,
      schemaName,
      reasoningEffort: h.writerEffort,
      kind: 'code',
      signal: args.signal,
    });
  // A writer that fails fails the build, but not before the outline is done (its error is the one reported).
  const keep = <T>(p: Promise<T>): Promise<T> => {
    p.catch((err) => (failure ??= err));
    return p;
  };

  const writeGame = () => {
    if (game) return;
    args.onProgress?.('Writing the game');
    game = keep(
      ask<{ code: string }>(
        `${args.user}\n\n## The plan (follow it exactly: other writers are writing the characters from it at the same time)\n${planText(o, 'backdrops')}\n\n## Your part\nWrite the game piece ${args.game.id}: the body of its method, on the stage. The characters' classes are written by others from the plan: use them only as the plan says (their names, fields, methods and messages), and call this.game.spawn / find / findAll with the cast's names.`,
        GAME_SCHEMA,
        'amble_game',
      ).then((r) => String(r.code ?? '')),
    );
  };

  // Characters are written in families (a character and the ones that build on it), each family as
  // soon as its last entry is in. Small ones wait to go with the next, so a handful of writers do the cast.
  let family: OutlineSprite[] = [];
  const familySize = (f: OutlineSprite[]) => f.reduce((n, s) => n + s.role.length + 120, 0);
  const writeFamily = (force: boolean) => {
    if (!family.length || (!force && familySize(family) < 500)) return;
    const members = family;
    family = [];
    const names = members.map((s) => `"${s.name}"`).join(', ');
    writers.push(
      keep(
        ask<{ sprites: Array<{ name: string; code: string }> }>(
          `${args.user}\n\n## The plan (follow it exactly: other writers are writing the game piece and the other characters from it at the same time)\n${planText(o, 'backdrops')}\n\n### The characters you write\n${members.map(castLine).join('\n')}\n\n## Your part\nWrite the whole class of ${members.length > 1 ? 'each of these characters' : 'this character'}: ${names}, in "sprites" (name and code). Each is \`class <Name> extends Sprite { ... }\`, or \`extends <Base>\` for one that builds on another character's class (override only what differs). Use the other characters and the stage only as the plan says.`,
          CAST_SCHEMA,
          'amble_cast',
        ).then((r) => (r.sprites ?? []).map((s) => ({ name: clean(s.name), code: String(s.code ?? '') }))),
      ),
    );
  };

  const titleOf = () => clean(o.title);
  const feed = watchReply({
    onField: (key, value) => {
      if (key === 'title' || key === 'howToPlay') {
        (o as Record<string, unknown>)[key] = clean(value);
        args.onOutline?.({ title: o.title, howToPlay: o.howToPlay });
      } else if (key === 'plan') o.plan = clean(value);
      else if (key === 'sounds' && Array.isArray(value)) {
        o.sounds = value as Outline['sounds'];
        args.onAssets?.(o.sounds.map((s) => ({ target: 'Stage', kind: 'sound', name: clean(s.name), description: clean(s.description), width: 0, height: 0, reuse: false })), titleOf());
      } else if (key === 'backdrops' && Array.isArray(value)) {
        o.backdrops = value as Outline['backdrops'];
        args.onAssets?.(o.backdrops.map((b) => ({ target: 'Stage', kind: 'backdrop', name: clean(b.name), description: clean(b.description), width: 480, height: 360, reuse: false })), titleOf());
        if (h.fanoutGame === 'backdrops') writeGame();
      } else if (key === 'cast') {
        writeFamily(true);
        writeGame();
      }
    },
    onItem: (key, item) => {
      if (key !== 'cast' || !item || typeof item !== 'object') return;
      const s = item as OutlineSprite;
      s.name = clean(s.name);
      s.base = clean(s.base);
      s.role = clean(s.role);
      if (!s.name || s.name.toLowerCase() === 'stage') return;
      cast.push(s);
      args.onAssets?.((s.costumes ?? []).map((c) => ({ target: s.name, kind: 'costume', name: clean(c.name), description: clean(c.description), width: Number(c.width) || 0, height: Number(c.height) || 0, reuse: false })), titleOf());
      // A character on its own (not building on one in the family so far) closes the family before it.
      if (!s.base || !family.some((m) => m.name === s.base)) writeFamily(false);
      family.push(s);
    },
  });

  args.onProgress?.('Planning your game');
  const outline = await chatJson<Outline>(args.transport, {
    model: args.settings.model,
    system: args.system,
    user: `${args.user}\n\n${GUIDE}`,
    schema: OUTLINE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'amble_outline',
    reasoningEffort: h.gameEffort ?? args.settings.reasoningEffort,
    kind: 'code',
    signal: args.signal,
    onText: feed,
  });
  // (Whatever the stream missed, the whole reply has: start what hasn't started.)
  Object.assign(o, { ...outline, cast: o.cast ?? outline.cast });
  if (!cast.length) for (const s of outline.cast ?? []) if (clean(s.name)) cast.push({ ...s, name: clean(s.name), base: clean(s.base), role: clean(s.role) });
  if (!writers.length && !family.length) family = [...cast];
  writeFamily(true);
  writeGame();
  args.onProgress?.(`Writing the game in ${writers.length + 1} parts at once`);

  const [stageCode, ...families] = await Promise.all([game!, ...writers]);
  if (failure) throw failure;
  const code = new Map(families.flat().map((s) => [s.name, s.code]));
  const assets: AssetRequest[] = [
    ...(outline.sounds ?? []).map((s) => ({ target: 'Stage', kind: 'sound' as const, name: clean(s.name), description: clean(s.description), width: 0, height: 0, reuse: false })),
    ...(outline.backdrops ?? []).map((b) => ({ target: 'Stage', kind: 'backdrop' as const, name: clean(b.name), description: clean(b.description), width: 480, height: 360, reuse: false })),
    ...cast.flatMap((s) => (s.costumes ?? []).map((c) => ({ target: s.name, kind: 'costume' as const, name: clean(c.name), description: clean(c.description), width: Number(c.width) || 0, height: Number(c.height) || 0, reuse: false }))),
  ];
  return {
    title: outline.title,
    howToPlay: outline.howToPlay,
    pieces: [{ id: args.game.id, code: stageCode }],
    sprites: cast.map((s) => ({ name: s.name, description: s.description, x: s.x, y: s.y, size: s.size, direction: s.direction, visible: s.visible, code: code.get(s.name) ?? '' })),
    assets,
    warnings: outline.warnings ?? [],
    questions: [],
  };
}
