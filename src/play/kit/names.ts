/** The kit's built-in sound and music names (the recipes are in src/runtime/kit/sounds.ts). Pure. */
export const SOUND_NAMES = [
  'coin', 'jump', 'laser', 'shoot', 'hit', 'stomp', 'explosion', 'boom', 'powerup', 'blip', 'pop', 'dash', 'zap', 'thud', 'roar',
  'flip', 'slowmo', 'combo', 'hurt', 'win', 'lose', 'bubble', 'splash',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export const MUSIC_STYLES = ['boss', 'adventure', 'chase', 'chill', 'spooky', 'chaos'] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number];
