/** JSON schemas for Structured Outputs (strict mode: every property required, no extras). */

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });

export interface AssetRequest {
  target: string;
  kind: 'costume' | 'backdrop' | 'model' | 'sound';
  name: string;
  description: string;
  width: number;
  height: number;
  reuse: boolean;
}

/** The reply to a compile request: code for each piece, plus any characters and art they need. */
export interface PiecesReply {
  pieces: Array<{ id: string; code: string }>;
  sprites: Array<{ name: string; description: string; x: number; y: number; z: number; size: number; direction: number; visible: boolean; code: string }>;
  assets: AssetRequest[];
  warnings: string[];
  /** Questions about words you had to guess at, each for one piece (shown on its block). */
  questions?: Array<{ piece: string; question: string }>;
}

export const PIECES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pieces', 'sprites', 'assets', 'warnings', 'questions'],
  properties: {
    pieces: {
      type: 'array',
      description: 'One entry per piece you were asked to write, plus any piece already written that you rewrite.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'code'],
        properties: {
          id: str('The piece id, e.g. "p1" (or "e2" to rewrite a piece already written).'),
          code: str('JavaScript: the body of the piece method only (no signature, no braces around it).'),
        },
      },
    },
    sprites: {
      type: 'array',
      description: 'New characters your pieces need that the project does not have (usually empty).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'x', 'y', 'z', 'size', 'direction', 'visible', 'code'],
        properties: {
          name: str(),
          description: str('What it is and what it does.'),
          x: num(),
          y: num(),
          z: num('0 in 2D.'),
          size: num('Percent, usually 100.'),
          direction: num('2D angle or 3D heading in degrees.'),
          visible: { type: 'boolean' },
          code: str('JavaScript: its whole class, `class <Name> extends Sprite { ... }`.'),
        },
      },
    },
    assets: {
      type: 'array',
      description: 'Art, 3D models and sounds your code uses that do not exist yet, plus earlier compiled ones to keep (reuse = true).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'kind', 'name', 'description', 'width', 'height', 'reuse'],
        properties: {
          target: str('Sprite name, or "Stage" for backdrops/stage sounds.'),
          kind: { type: 'string', enum: ['costume', 'backdrop', 'model', 'sound'] },
          name: str('Name used in code.'),
          description: str('Vivid, specific description of how it looks or sounds.'),
          width: num('Pixels for images, meters for models, 0 for sounds.'),
          height: num('Pixels for images, meters for models, 0 for sounds.'),
          reuse: { type: 'boolean', description: 'true to keep a previously compiled asset unchanged.' },
        },
      },
    },
    warnings: { type: 'array', items: str(), description: 'Words you could not turn into code, or problems the author should know about.' },
    questions: {
      type: 'array',
      description: 'Usually empty. At most one per piece, only when its words could mean quite different games and your guess matters.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['piece', 'question'],
        properties: {
          piece: str('The piece id, e.g. "p1".'),
          question: str('What you picked, then a short open question a child can answer in a few words, whose answer reads well added after the words (never yes or no), e.g. "I made the stars fall slowly. How fast should they fall?"'),
        },
      },
    },
  },
} as const;

export interface SvgReply {
  svg: string;
}

export const SVG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['svg'],
  properties: { svg: str('A complete <svg> document.') },
} as const;

export const MODEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['parts'],
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['shape', 'size', 'position', 'rotation', 'color', 'roughness', 'metalness', 'emissive', 'opacity'],
        properties: {
          shape: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule'] },
          size: { type: 'array', items: { type: 'number' }, description: '[width, height, depth] bounding size in meters' },
          position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] center in meters; y=0 is the ground/feet' },
          rotation: { type: 'array', items: { type: 'number' }, description: '[x, y, z] degrees' },
          color: str('#rrggbb'),
          roughness: num('0 shiny .. 1 matte'),
          metalness: num('0..1'),
          emissive: num('0..1 glow'),
          opacity: num('0..1'),
        },
      },
    },
  },
} as const;

export const SOUND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['wave', 'startFreq', 'endFreq', 'duration', 'startVolume', 'endVolume'],
        properties: {
          wave: { type: 'string', enum: ['sine', 'square', 'triangle', 'sawtooth', 'noise'] },
          startFreq: num('Hz'),
          endFreq: num('Hz'),
          duration: num('seconds'),
          startVolume: num('0..1'),
          endVolume: num('0..1'),
        },
      },
    },
  },
} as const;
