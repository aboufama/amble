/**
 * Twists: rule-breaking switches the student flips on any kit game, live, with no AI. This is the catalog
 * (names and words for the Tune panel and the local "say it" matcher); twists.ts implements them. Pure.
 */

export interface TwistDef {
  id: string;
  name: string;
  /** Icon name in the editor's icon set. */
  icon: string;
  does: string;
  /** Extra words a student might say for it. */
  words: string;
}

export const TWISTS = [
  { id: 'moonGravity', name: 'Moon gravity', icon: 'moon', does: 'Gravity gets much weaker, so jumps float.', words: 'moon low gravity floaty float space bouncy jumps' },
  { id: 'gravityFlips', name: 'Gravity flips', icon: 'arrows-up-down', does: 'Every 12 seconds the world turns upside down.', words: 'flip gravity upside down ceiling reverse' },
  { id: 'giantHero', name: 'Giant mode', icon: 'tower', does: 'Your hero is huge and smashes enemies.', words: 'giant huge big hero smash grow mushroom' },
  { id: 'tinyHero', name: 'Tiny mode', icon: 'ant', does: 'Your hero is tiny and quick.', words: 'tiny small little shrink mini fast' },
  { id: 'slowmoHits', name: 'Slow-mo hits', icon: 'clock', does: 'Every enemy you beat goes out in slow motion.', words: 'slow motion slowmo hits matrix dramatic' },
  { id: 'slowTime', name: 'Slow time', icon: 'hourglass', does: 'The whole game runs slower.', words: 'slow time slower easy relaxed chill' },
  { id: 'bouncyWorld', name: 'Bouncy world', icon: 'ball', does: 'Everything bounces.', words: 'bouncy bounce trampoline rubber boing' },
  { id: 'starRain', name: 'Rain of stars', icon: 'sparkle', does: 'Now and then, treasure falls from the sky.', words: 'rain stars coins treasure sky falling items' },
  { id: 'enemyParty', name: 'Enemy party', icon: 'crowd', does: 'Every enemy brings a friend.', words: 'more enemies party double crowd harder' },
  { id: 'speedUp', name: 'Speed-up', icon: 'bolt', does: 'The game gets faster and faster.', words: 'faster speed up quicker hurry turbo' },
  { id: 'surpriseBoss', name: 'Surprise boss', icon: 'crown', does: 'After a minute, a giant boss shows up.', words: 'surprise boss giant monster big enemy' },
  { id: 'earthquake', name: 'Earthquake', icon: 'quake', does: 'Every 15 seconds the ground shakes things loose.', words: 'earthquake shake quake rumble tremor' },
  { id: 'doubleJump', name: 'Double jump', icon: 'jump', does: 'Your hero can jump again in the air.', words: 'double jump air jump twice extra jump' },
] as const satisfies readonly TwistDef[];

export type TwistId = (typeof TWISTS)[number]['id'];

export const TWIST_IDS: readonly TwistId[] = TWISTS.map((t) => t.id);

export function isTwistId(id: string): id is TwistId {
  return (TWIST_IDS as readonly string[]).includes(id);
}
