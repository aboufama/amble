/** JSON schemas for Structured Outputs (strict mode: every property required, no extras). */

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });

export interface CompileReply {
  summary: string;
  howToPlay: string;
  sprites: Array<{ name: string; description: string; x: number; y: number; z: number; size: number; direction: number; visible: boolean }>;
  assets: Array<{ target: string; kind: 'costume' | 'backdrop' | 'model' | 'sound'; name: string; description: string; width: number; height: number; reuse: boolean }>;
  code: Array<{ target: string; source: string }>;
  warnings: string[];
}

export const COMPILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'howToPlay', 'sprites', 'assets', 'code', 'warnings'],
  properties: {
    summary: str('2-5 sentences: what the game is and how you interpreted the blocks.'),
    howToPlay: str('Short instructions for the player (controls and goal). Empty if not a game.'),
    sprites: {
      type: 'array',
      description: 'Sprites you add because the game needs them (not ones the author already has). Usually empty.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'x', 'y', 'z', 'size', 'direction', 'visible'],
        properties: {
          name: str(),
          description: str('What it is and what it does.'),
          x: num(),
          y: num(),
          z: num('0 in 2D.'),
          size: num('Percent, usually 100.'),
          direction: num('2D angle or 3D heading in degrees.'),
          visible: { type: 'boolean' },
        },
      },
    },
    assets: {
      type: 'array',
      description: 'Every compiled (AI-made) asset the game uses: new ones and reused ones.',
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
    code: {
      type: 'array',
      description: 'One entry per target (stage or sprite) that has behavior.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'source'],
        properties: {
          target: str('Exact sprite name, or "Stage".'),
          source: str('JavaScript: one class declaration (plus optional helpers before it).'),
        },
      },
    },
    warnings: { type: 'array', items: str(), description: 'Ambiguities, assumptions, or blocks you could not implement.' },
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
