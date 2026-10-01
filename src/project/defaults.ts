import { synthToDataUrl, SOUND_PRESETS } from '../audio/synth';
import { BLOCK_BY_TYPE, SHADOW_TYPES } from '../blocks/spec';
import { svgDataUrl } from './images';
import { uid } from './ids';
import type { BlocksState, ImageAsset, Project, SoundAsset, SpriteTarget, StageTarget } from './types';

// -----------------------------------------------------------------------------
// Blocks helpers (Blockly JSON serialization)
// -----------------------------------------------------------------------------

export interface JsonBlock {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, string>;
  inputs?: Record<string, { block?: JsonBlock; shadow?: JsonBlock }>;
  next?: { block: JsonBlock };
}

/** What a block's input gets in `block(type, args)`: typed words or numbers, or a block to drop in. */
export type BlockArg = string | number | JsonBlock;

/** A shadow that fills a value slot until something is dropped in (see SHADOW_TYPES). */
function shadow(kind: 'number' | 'value' | 'character', value: string): JsonBlock {
  const type = SHADOW_TYPES[kind];
  const field = kind === 'number' ? 'NUM' : kind === 'value' ? 'TEXT' : 'NAME';
  return { type, id: uid('b'), fields: { [field]: value } };
}

/**
 * A block, built from the block language (src/blocks/spec.ts). `args` fills inputs by name:
 * words and menu choices as strings, numbers as numbers, and reporter/boolean blocks as blocks.
 * Inputs left out get their defaults. `inner` fills the C-slot (SUBSTACK); `inner2` the else slot.
 */
export function block(type: string, args: Record<string, BlockArg> = {}, inner?: JsonBlock[], inner2?: JsonBlock[]): JsonBlock {
  const spec = BLOCK_BY_TYPE.get(type);
  const b: JsonBlock = { type, id: uid('b') };
  const fields: Record<string, string> = {};
  const inputs: NonNullable<JsonBlock['inputs']> = {};
  for (const [name, input] of Object.entries(spec?.inputs ?? {})) {
    const arg = args[name];
    const given = arg !== undefined && typeof arg !== 'object' ? String(arg) : undefined;
    switch (input.kind) {
      case 'text':
      case 'label':
      case 'menu':
        fields[name] = given ?? input.default ?? '';
        break;
      case 'number':
      case 'value':
      case 'character':
        inputs[name] = { shadow: shadow(input.kind, given ?? input.default ?? '') };
        if (typeof arg === 'object') inputs[name].block = arg;
        break;
      case 'condition':
        if (typeof arg === 'object') inputs[name] = { block: arg };
        break;
    }
  }
  const first = chain(inner ?? []);
  if (first) inputs.SUBSTACK = { block: first };
  const second = chain(inner2 ?? []);
  if (second) inputs.SUBSTACK2 = { block: second };
  if (Object.keys(fields).length) b.fields = fields;
  if (Object.keys(inputs).length) b.inputs = inputs;
  return b;
}

/** A character block, to drop into a character slot: a sprite's name or a special ("me", "mouse"...). */
export function character(name: string): JsonBlock {
  return { type: 'char_ref', id: uid('b'), fields: { NAME: name } };
}

/** A variable's round block. */
export function variable(name: string): JsonBlock {
  return { type: 'mem_var', id: uid('b'), fields: { VARIABLE: name } };
}

/** Links blocks top to bottom and returns the first. */
export function chain(blocks: JsonBlock[]): JsonBlock | undefined {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}

/** A whole workspace: each entry is a script (list of blocks) or a standalone block, placed top to bottom. */
export function workspace(...scripts: Array<JsonBlock[] | JsonBlock>): BlocksState {
  let y = 24;
  const tops = scripts.map((entry) => {
    const s = Array.isArray(entry) ? entry : [entry];
    const first = chain(s)!;
    first.x = 24;
    first.y = y;
    y += (s.length > 1 || BLOCK_BY_TYPE.get(first.type)?.shape === 'hat' ? 70 : 40) + s.length * 58;
    return first;
  });
  return { blocks: { languageVersion: 0, blocks: tops } };
}

// -----------------------------------------------------------------------------
// Default art: "Amble", a friendly little walker
// -----------------------------------------------------------------------------

function ambleSvg(frame: 'a' | 'b'): string {
  const back = frame === 'a' ? { x: 30, y: 96 } : { x: 38, y: 97 };
  const front = frame === 'a' ? { x: 64, y: 97 } : { x: 58, y: 96 };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="106" viewBox="0 0 96 106">
  <ellipse cx="${back.x}" cy="${back.y}" rx="13" ry="7" fill="#e0782f" stroke="#6b3412" stroke-width="3"/>
  <path d="M48 16c24 0 38 18 38 42s-14 36-38 36S10 82 10 58 24 16 48 16z" fill="#ffb347" stroke="#6b3412" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M48 16c-2-9-9-14-18-13 3 7 9 12 18 13z" fill="#6cc04a" stroke="#2f6b1f" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M49 16c3-8 10-11 17-9-3 6-9 9-17 9z" fill="#86d35f" stroke="#2f6b1f" stroke-width="2.5" stroke-linejoin="round"/>
  <ellipse cx="52" cy="70" rx="23" ry="17" fill="#ffe2b8"/>
  <ellipse cx="44" cy="46" rx="8.5" ry="10.5" fill="#fff" stroke="#6b3412" stroke-width="2.5"/>
  <ellipse cx="68" cy="46" rx="8.5" ry="10.5" fill="#fff" stroke="#6b3412" stroke-width="2.5"/>
  <circle cx="47.5" cy="48" r="4.5" fill="#2b1a10"/>
  <circle cx="71.5" cy="48" r="4.5" fill="#2b1a10"/>
  <circle cx="49" cy="46" r="1.4" fill="#fff"/>
  <circle cx="73" cy="46" r="1.4" fill="#fff"/>
  <path d="M50 62q9 8 18 0" fill="none" stroke="#6b3412" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="33" cy="60" rx="5" ry="3.5" fill="#ff8a7a" opacity="0.7"/>
  <ellipse cx="${front.x}" cy="${front.y}" rx="13" ry="7" fill="#f08a3e" stroke="#6b3412" stroke-width="3"/>
</svg>`;
}

export function svgAsset(name: string, svg: string, width: number, height: number, center?: { x: number; y: number }): ImageAsset {
  return {
    id: uid('a'),
    name,
    kind: 'image',
    dataUrl: svgDataUrl(svg),
    mime: 'image/svg+xml',
    width,
    height,
    resolution: 1,
    centerX: center?.x ?? width / 2,
    centerY: center?.y ?? height / 2,
  };
}

export function blankBackdrop(name = 'backdrop1', color = '#ffffff'): ImageAsset {
  return svgAsset(name, `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="${color}"/></svg>`, 480, 360);
}

export function synthSound(name: string, preset: keyof typeof SOUND_PRESETS): SoundAsset {
  const { dataUrl, duration } = synthToDataUrl(SOUND_PRESETS[preset]);
  return { id: uid('a'), name, kind: 'sound', dataUrl, mime: 'audio/wav', duration };
}

export function ambleCostumes(): ImageAsset[] {
  return [svgAsset('amble-a', ambleSvg('a'), 96, 106, { x: 48, y: 58 }), svgAsset('amble-b', ambleSvg('b'), 96, 106, { x: 48, y: 58 })];
}

// -----------------------------------------------------------------------------
// Targets and projects
// -----------------------------------------------------------------------------

export function newStage(): StageTarget {
  return {
    id: uid('t'),
    kind: 'stage',
    name: 'Stage',
    description: '',
    costumes: [blankBackdrop()],
    sounds: [],
    currentCostume: 0,
    blocks: null,
  };
}

export function newSprite(name: string, costumes: SpriteTarget['costumes'] = [], x = 0, y = 0): SpriteTarget {
  return {
    id: uid('t'),
    kind: 'sprite',
    name,
    description: '',
    costumes,
    sounds: [],
    currentCostume: 0,
    blocks: null,
    x,
    y,
    z: 0,
    size: 100,
    direction: 0,
    visible: true,
    rotationStyle: 'left-right',
  };
}

/**
 * A fresh project: Amble walks, jumps and lands, built only from exact blocks, so it compiles
 * instantly. The stage holds a short brief.
 */
export function newProject(): Project {
  const amble = newSprite('Amble', ambleCostumes(), 0, -60);
  amble.description = 'The player: a small, friendly walking creature.';
  amble.sounds = [synthSound('pop', 'pop'), synthSound('jump', 'jump')];
  amble.blocks = workspace(
    [
      block('ev_start'),
      block('kit_gravity'),
      block('kit_walk', { KEYS: 'left and right arrows', SPEED: 220 }),
      block('kit_jump', { KEY: 'space', POWER: 650 }),
      block('lk_say_for', { TEXT: "Hi! I'm Amble. Arrows to walk, space to jump!", SECONDS: 3 }),
    ],
    [block('ev_key', { KEY: 'space' }), block('so_play', { SOUND: 'jump' })],
    [block('ev_click'), block('lk_say_for', { TEXT: 'Hello!', SECONDS: 2 }), block('so_play', { SOUND: 'pop' })],
  );
  const stage = newStage();
  stage.blocks = workspace(block('br_game', { WHAT: 'Amble explores a little world' }), block('br_audience', { WHO: 'kids who are new to games' }));
  return {
    format: 'amble',
    version: 1,
    id: uid('p'),
    title: 'Untitled game',
    notes: '',
    mode: '2d',
    stage,
    sprites: [amble],
    variables: ['my variable'],
    compiled: null,
  };
}
