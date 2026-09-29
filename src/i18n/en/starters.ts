/**
 * Student-facing strings for the starter worlds (M8). Keys are flat. `staff_` keys are for teachers and IT
 * (exempt from the banned-word check). The games' own words (titles, hints, the cast's ask lines) live in
 * their code, because they are part of each world and the student can change them.
 */
import type { Strings } from '../types';

export const starters = {
  moonKingTitle: 'Moon King',
  moonKingGenre: 'Boss fight',
  moonKingBlurb: 'One giant grumpy moon. Three wild phases.',
  skyRunTitle: 'Sky Run',
  skyRunGenre: 'Runner',
  skyRunBlurb: 'Run forever over the clouds. Flip upside down!',
  wobbleTowerTitle: 'Wobble Tower',
  wobbleTowerGenre: 'Physics toy',
  wobbleTowerBlurb: 'Stack it high before the wind knocks it down.',
  lanternMazeTitle: 'Lantern Maze',
  lanternMazeGenre: 'Maze',
  lanternMazeBlurb: 'Find the lanterns. Scare the ghosts.',
  clanksClimbTitle: "Clank's Climb",
  clanksClimbGenre: 'Platformer',
  clanksClimbBlurb: 'Climb to the rocket before the goo gets you.',
  paradeTitle: 'Parade',
  paradeGenre: 'Parade',
  paradeBlurb: 'Every character walks the lit path.',
  staff_moonKingTeaches: 'state machines, bullet patterns, boss phases',
  staff_skyRunTeaches: 'procedural levels, parallax, combos, gravity',
  staff_wobbleTowerTeaches: 'physics bodies, forces, ragdolls',
  staff_lanternMazeTeaches: 'tile maps, rule-based ghost brains',
  staff_clanksClimbTeaches: 'platformer feel, rising hazards, stomping',
  staff_paradeTeaches: 'showing every character',
  stepStarted: 'You started {title}',
  credits: "Drawings made for Amble's starter worlds.",
} satisfies Strings;
