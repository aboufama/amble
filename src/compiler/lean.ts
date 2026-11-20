/**
 * The harness's "lean" reply for a new game (`lean`): one reply, as before, but it starts with a
 * compact cast list instead of a long asset list:
 *
 *   title, howToPlay,
 *   cast: each new character's name, what it is and looks like (one sentence), its place, and its
 *         costumes by name with a pose each (a few words): its drawings start as soon as its entry is in;
 *   backdrops, sounds: a name and a few words each (sounds come from the library at once);
 *   pieces, sprites: the code, as in any reply (a character's class by its name in the cast).
 *
 * The asset list was a third of a new game's reply and all of it came before the first line of
 * code; the art now starts a few seconds in, and the code sooner.
 */
import { PIECES_SCHEMA, type AssetRequest, type PiecesReply } from './schema';
import { watchReply } from './stream';

interface LeanCostume {
  name: string;
  pose: string;
}

interface LeanCharacter {
  name: string;
  description: string;
  width: number;
  height: number;
  costumes: LeanCostume[];
  x: number;
  y: number;
  size: number;
  direction: number;
  visible: boolean;
}

export interface LeanReply {
  title: string;
  howToPlay: string;
  cast: LeanCharacter[];
  backdrops: Array<{ name: string; looks: string }>;
  sounds: Array<{ name: string; sound: string }>;
  pieces: PiecesReply['pieces'];
  sprites: Array<{ name: string; code: string }>;
  warnings: string[];
  questions: NonNullable<PiecesReply['questions']>;
}

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const pair = (key: string, description: string) => ({
  type: 'array',
  items: { type: 'object', additionalProperties: false, required: ['name', key], properties: { name: str(), [key]: str(description) } },
});

/** Field order is the order the build needs them in (models write "required" or "properties" order: both say this). */
/**
 * The lean reply's schema. With `balance`, a short check of the game's numbers comes between the
 * cast and the code. With `castWriter`, the characters' classes are written by a second request at
 * the same time (see CAST_WRITER_GUIDE): this reply writes a contract instead, and no "sprites".
 */
export function leanSchema(balance: boolean, castWriter = false, spritesFirst = false, slimContract = false): typeof LEAN_SCHEMA {
  if (!balance && !castWriter && !spritesFirst) return LEAN_SCHEMA;
  const required: string[] = [...LEAN_SCHEMA.required].filter((k) => !(castWriter && k === 'sprites'));
  // The characters' classes before the game piece: art their code uses that the cast left out starts sooner.
  if (spritesFirst && !castWriter) {
    required.splice(required.indexOf('sprites'), 1);
    required.splice(required.indexOf('pieces'), 0, 'sprites');
  }
  const extra = [...(castWriter ? ['contract'] : []), ...(balance ? ['balance'] : [])];
  required.splice(required.indexOf('pieces'), 0, ...extra);
  const all: Record<string, unknown> = {
    ...LEAN_SCHEMA.properties,
    contract: str(
      slimContract
        ? 'One short line per character: what the game piece and the others use of it (its methods with arguments, its fields, the messages it sends and handles, with their data). Then the this.game.vars keys (meaning, start value). Its behavior is its cast description and the balance: no more here.'
        : 'For each character, a few lines: its behavior (how it moves and thinks, reacts, animates), then what others use of it: its methods (with arguments) and fields, the messages it sends and handles (with their data). Then every this.game.vars key (meaning, start value). Compact lines.',
    ),
    balance: str('Before the code, a few short lines: each act or wave with its numbers (how long, how many, how fast), every timer and limit, and why a first-time player who plays well wins in about the time the dial asks (and how one who struggles still sees the next act). Fix the numbers here, then use them.'),
  };
  return { ...LEAN_SCHEMA, required, properties: Object.fromEntries(required.map((k) => [k, all[k]])) } as unknown as typeof LEAN_SCHEMA;
}

/** For the main reply, when a second request writes the characters' classes at the same time. */
export const CAST_WRITER_GUIDE = `## Two writers at once
Another writer writes every cast member's class at the same time as you write the game piece, from your reply up to "contract" (and "balance"): so there is no "sprites" in this reply, whatever the notes above say. Split the work between you, about evenly:
- The game piece directs: the setup, the HUD, spawning and the waves, the arc and its acts, the boss's entrance, the ending. It doesn't move, steer or animate characters itself.
- Each character's own behavior is its class's: how it moves and thinks, how it reacts (to the player, to being hit, herded or collected), its animation and its juice. Say it in "contract", a few lines for each character, so its writer can write it all.
"contract" also says exactly what the game piece and the characters use of each other (methods with arguments, fields, messages with data, this.game.vars keys); in the game piece, use the characters only as it says.`;

/** The two writers with a one-line contract per character (`slimContract`): the second writer starts seconds sooner. */
export const CAST_WRITER_GUIDE_SLIM = `## Two writers at once
Another writer writes every cast member's class at the same time as you write the game piece, starting the moment your reply reaches "contract" (and "balance"): so there is no "sprites" in this reply, whatever the notes above say, and the header must be quick to write. Split the work between you, about evenly:
- The game piece directs: the setup, the HUD, spawning and the waves, the arc and its acts, the boss's entrance, the ending. It doesn't move, steer or animate characters itself.
- Each character's own behavior is its class's: how it moves and thinks, how it reacts, its animation and its juice. Its cast description says what it does (two sentences at most), and "balance" its numbers: that is all its writer gets.
"contract" is one short line per character: exactly what the game piece and the characters use of each other (methods with arguments, fields, messages with data), then the this.game.vars keys. In the game piece, use the characters only as it says.`;

/** The plan the cast writer works from: the main reply's header, as text. */
export function headerText(h: LeanHeader): string {
  const lines = [`Title: ${h.title ?? ''}`, `How to play: ${h.howToPlay ?? ''}`, '', '### The cast'];
  for (const c of h.cast) lines.push(`- "${clean(c.name)}" (${Number(c.width) || 0} x ${Number(c.height) || 0}, starts at x=${c.x}, y=${c.y}, ${c.visible === false ? 'hidden' : 'visible'}): ${clean(c.description)} Costumes: ${(c.costumes ?? []).map((x) => `"${clean(x.name)}" (${clean(x.pose)})`).join(', ')}`);
  lines.push('', '### Backdrops', ...(h.backdrops ?? []).map((b) => `- "${clean(b.name)}": ${clean(b.looks)}`));
  lines.push('', '### Sounds', ...(h.sounds ?? []).map((x) => `- "${clean(x.name)}": ${clean(x.sound)}`));
  lines.push('', '### Contract', clean(h.contract));
  if (h.balance) lines.push('', '### Balance', clean(h.balance));
  return lines.join('\n');
}

/** The cast writer's part of its request. */
export function castWriterPart(h: LeanHeader, only?: string[]): string {
  const who = only?.length
    ? `the characters ${only.map((n) => `"${n}"`).join(', ')} (only these: other writers write the rest of the cast at the same time, as the contract says)`
    : 'every character in the cast';
  return `## The plan (written by the game's main writer, who is writing the game piece from it right now)\n${headerText(h)}\n\n## Your part\nWrite the whole class of ${who}, in "sprites" (name and code): \`class <Name> extends Sprite { ... }\`, or \`extends <Another character>\` to build on its class (override only what differs). The game piece only directs (spawning, waves, the HUD, the arc): everything a character does itself is yours to write, in full, as the contract describes it: how it moves and thinks, how it reacts, its animation, and its juice (particles, squash, flashes, sounds at its moments). Use the stage and the other characters only as the contract says, with exactly the costume and sound names above.`;
}

export const CAST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sprites'],
  properties: { sprites: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'code'], properties: { name: str(), code: str('Its whole class.') } } } },
} as const;

export interface LeanHeader {
  title?: string;
  howToPlay?: string;
  cast: LeanCharacter[];
  backdrops?: LeanReply['backdrops'];
  sounds?: LeanReply['sounds'];
  contract?: string;
  balance?: string;
}

/** The art and sounds a header asks for. */
export const headerAssets = (h: LeanHeader): AssetRequest[] => [...h.cast.flatMap(costumesOf), ...backdropsOf(h.backdrops ?? []), ...soundsOf(h.sounds ?? [])];

export const LEAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'howToPlay', 'cast', 'backdrops', 'sounds', 'pieces', 'sprites', 'warnings', 'questions'],
  properties: {
    title: PIECES_SCHEMA.properties.title,
    howToPlay: PIECES_SCHEMA.properties.howToPlay,
    cast: {
      type: 'array',
      description: 'Every new character the game adds (none of the project\'s own sprites), in the order: the player, then the rest.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'width', 'height', 'costumes', 'x', 'y', 'size', 'direction', 'visible'],
        properties: {
          name: str('Also its class name: letters only, e.g. "Hen".'),
          description: str('One sentence: what it is, what it looks like, what it does.'),
          width: num('Its costumes\' size in pixels (16..400).'),
          height: num(),
          costumes: { ...pair('pose', 'A few words: how this frame differs (e.g. "standing", "left foot forward", "wings up").'), description: 'Frames of this one character, drawn together.' },
          x: num(),
          y: num(),
          size: num(),
          direction: num(),
          visible: { type: 'boolean' },
        },
      },
    },
    backdrops: pair('looks', 'One short sentence: what the stage shows.'),
    sounds: pair('sound', 'A few words: what makes it and how it feels; music starts with "music:" and a style, a short tune with "jingle:".'),
    pieces: PIECES_SCHEMA.properties.pieces,
    sprites: {
      type: 'array',
      description: 'The class of each character in "cast".',
      items: { type: 'object', additionalProperties: false, required: ['name', 'code'], properties: { name: str(), code: str('Its whole class: `class <Name> extends Sprite { ... }`, or `extends <Another character>` to build on its class.') } },
    },
    warnings: PIECES_SCHEMA.properties.warnings,
    questions: PIECES_SCHEMA.properties.questions,
  },
} as const;

/** The lean guide with the characters' classes written before the game piece (`spritesFirst`). */
export const LEAN_GUIDE_SPRITES_FIRST = `## This reply's order
A new game's reply starts with its cast, and the build starts drawing while you write the code: "cast" first (every new character, with every costume its class will use, by name, and a pose for each), then "backdrops" and "sounds" (a name and a few words each: there is no "assets" list; these are its art and sounds), then the code: first "sprites", each cast member's class, then "pieces", the game piece that directs them. Use exactly those costume, backdrop and sound names in the code.`;

export const LEAN_GUIDE = `## This reply's order
A new game's reply starts with its cast, and the build starts drawing while you write the code: "cast" first (every new character, with its costumes by name and a pose for each), then "backdrops" and "sounds" (a name and a few words each: there is no "assets" list; these are its art and sounds), then the code: "pieces", and in "sprites" each cast member's class. Use exactly those costume, backdrop and sound names in the code.`;

const clean = (s: unknown) => String(s ?? '').trim();

function costumesOf(c: LeanCharacter): AssetRequest[] {
  const name = clean(c.name);
  const look = clean(c.description);
  return (c.costumes ?? [])
    .filter((x) => clean(x.name))
    .map((x) => ({ target: name, kind: 'costume' as const, name: clean(x.name), description: `${look}${clean(x.pose) ? ` Pose: ${clean(x.pose)}.` : ''}`, width: Number(c.width) || 0, height: Number(c.height) || 0, reuse: false }));
}

const backdropsOf = (list: LeanReply['backdrops']): AssetRequest[] =>
  (list ?? []).filter((b) => clean(b.name)).map((b) => ({ target: 'Stage', kind: 'backdrop' as const, name: clean(b.name), description: clean(b.looks) || clean(b.name), width: 480, height: 360, reuse: false }));

const soundsOf = (list: LeanReply['sounds']): AssetRequest[] =>
  (list ?? []).filter((s) => clean(s.name)).map((s) => ({ target: 'Stage', kind: 'sound' as const, name: clean(s.name), description: clean(s.sound) || clean(s.name), width: 0, height: 0, reuse: false }));

/**
 * Watches a lean reply as it streams: each character's costumes as soon as its entry is in, then the
 * backdrops, then the sounds; and (`onClass`) each character's class as soon as it is written, with
 * the art asked for so far, so art its code uses that the cast left out can start before the reply ends.
 */
export function watchLean(
  onAssets: (assets: AssetRequest[], title: string) => void,
  onClass?: (name: string, code: string, asked: AssetRequest[], title: string) => void,
  /** Once the field that ends the header (`headerEnd`) is written: the header, for a second writer. */
  onHeader?: { headerEnd: 'contract' | 'balance'; call: (h: LeanHeader) => void },
): (text: string) => void {
  let title = '';
  const asked: AssetRequest[] = [];
  const header: LeanHeader = { cast: [] };
  const ask = (list: AssetRequest[]) => {
    asked.push(...list);
    onAssets(list, title);
  };
  return watchReply({
    onField: (key, value) => {
      if (['title', 'howToPlay', 'contract', 'balance'].includes(key)) (header as unknown as Record<string, unknown>)[key] = clean(value);
      if (key === 'title') title = clean(value);
      else if (key === 'backdrops' && Array.isArray(value)) ask(backdropsOf((header.backdrops = value as LeanReply['backdrops'])));
      else if (key === 'sounds' && Array.isArray(value)) ask(soundsOf((header.sounds = value as LeanReply['sounds'])));
      if (onHeader && key === onHeader.headerEnd) onHeader.call(header);
    },
    onItem: (key, item) => {
      if (!item || typeof item !== 'object') return;
      if (key === 'cast') {
        header.cast.push(item as LeanCharacter);
        ask(costumesOf(item as LeanCharacter));
      } else if (key === 'sprites' && onClass) {
        const s = item as { name?: string; code?: string };
        if (clean(s.name) && s.code) onClass(clean(s.name), String(s.code), asked, title);
      }
    },
  });
}

/** A lean reply as an ordinary one (characters with their code, and the asset list). */
export function fromLean(r: LeanReply): PiecesReply {
  const code = new Map((r.sprites ?? []).map((s) => [clean(s.name), String(s.code ?? '')]));
  const cast = (r.cast ?? []).filter((c) => clean(c.name));
  // A class written for a character the cast left out still comes (as a character with no place given).
  for (const [name] of code) if (!cast.some((c) => clean(c.name) === name)) cast.push({ name, description: '', width: 0, height: 0, costumes: [], x: 0, y: 0, size: 100, direction: 0, visible: true });
  return {
    title: r.title,
    howToPlay: r.howToPlay,
    pieces: r.pieces ?? [],
    sprites: cast.map((c) => ({ name: clean(c.name), description: clean(c.description), x: c.x, y: c.y, size: c.size, direction: c.direction, visible: c.visible, code: code.get(clean(c.name)) ?? '' })),
    assets: [...cast.flatMap(costumesOf), ...backdropsOf(r.backdrops), ...soundsOf(r.sounds)],
    warnings: r.warnings ?? [],
    questions: r.questions ?? [],
  };
}
