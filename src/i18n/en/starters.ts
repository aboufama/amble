/**
 * Student-facing strings for M8 (FOUNDATION-STUB: only what the stub catalog shows; M8 replaces it).
 * Keys are flat. `staff_` keys are for teachers and IT (exempt from the banned-word check); `page_` keys
 * may be long paragraphs (in-app pages); `legacy_` keys may name the old block editor.
 */
import type { Strings } from '../types';

export const starters = {
  moonKingTitle: 'Moon King',
  moonKingGenre: 'Boss fight',
  moonKingBlurb: 'One giant boss. Three wild phases.',
  skyRunTitle: 'Sky Run',
  skyRunGenre: 'Runner',
  skyRunBlurb: "Run forever. Flip gravity. Don't fall.",
  wobbleTowerTitle: 'Wobble Tower',
  wobbleTowerGenre: 'Physics toy',
  wobbleTowerBlurb: 'Stack it, smash it, watch it wobble.',
  lanternMazeTitle: 'Lantern Maze',
  lanternMazeGenre: 'Maze',
  lanternMazeBlurb: 'Find the lanterns. Scare the ghosts.',
  clanksClimbTitle: "Clank's Climb",
  clanksClimbGenre: 'Platformer',
  clanksClimbBlurb: 'Climb to the top. Stomp the baddies.',
  paradeTitle: 'Parade',
  paradeGenre: 'Parade',
  paradeBlurb: 'Every character walks the lit path.',
  staff_moonKingTeaches: 'state machines, bullet patterns, phases',
  staff_skyRunTeaches: 'procedural levels, parallax, combos',
  staff_wobbleTowerTeaches: 'physics bodies, forces, ragdolls',
  staff_lanternMazeTeaches: 'tile maps, rule-based ghost brains',
  staff_clanksClimbTeaches: 'platformer feel, rising hazards, stomping',
  staff_paradeTeaches: 'showing every character',
  stepStarted: 'You started {title}',
} satisfies Strings;
