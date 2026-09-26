import { ambleCostumes, block, newProject, newSprite, svgAsset, synthSound, workspace } from './defaults';
import type { Project } from './types';

const nightSky = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f4b"/><stop offset="1" stop-color="#4a3f8c"/></linearGradient></defs>
  <rect width="480" height="360" fill="url(#g)"/>
  <g fill="#fff">
    <circle cx="40" cy="40" r="1.6"/><circle cx="120" cy="90" r="1.2"/><circle cx="200" cy="30" r="1.8"/><circle cx="310" cy="70" r="1.3"/>
    <circle cx="420" cy="40" r="1.7"/><circle cx="370" cy="140" r="1.1"/><circle cx="80" cy="150" r="1.2"/><circle cx="250" cy="120" r="1"/>
  </g>
  <circle cx="400" cy="70" r="26" fill="#fff6c9"/><circle cx="410" cy="62" r="24" fill="#2a2a62"/>
  <path d="M0 300 Q 80 260 160 295 T 320 290 T 480 285 V360 H0z" fill="#2e6b3f"/>
  <path d="M0 320 Q 120 290 240 318 T 480 312 V360 H0z" fill="#3f8a4f"/>
</svg>`;

/** 2D: catch falling stars. The stars are not drawn, so the compiler makes them. */
export function starCatcher(): Project {
  const p = newProject('2d');
  p.title = 'Star Catcher';
  p.notes = 'Stars fall from the top of the sky at random places. Move Amble left and right to catch them. Each catch is a point; after 3 missed stars the game is over. Stars fall a little faster over time.';
  p.stage.costumes = [svgAsset('night sky', nightSky, 480, 360)];
  p.stage.blocks = workspace(
    [block('ev_start'), block('va_set', { VARIABLE: 'score', VALUE: '0' }), block('va_set', { VARIABLE: 'misses', VALUE: '0' }), block('va_show', { VARIABLE: 'score and misses' }), block('so_music', { MUSIC: 'none' })],
    [block('ga_rule', { RULE: 'a new star falls every second or so, from a random spot at the top' })],
  );
  const amble = p.sprites[0];
  amble.y = -120;
  amble.description = 'The catcher. Walks along the grass at the bottom.';
  amble.blocks = workspace(
    [
      block('ev_start'),
      block('mo_goto', { WHERE: 'the bottom middle, standing on the grass' }),
      block('mo_control', { CONTROLS: 'left and right arrow keys, quick and snappy, stay on screen' }),
      block('lo_animate', { HOW: 'walk while moving' }),
    ],
    [block('ev_when', { EVENT: 'I touch a falling star' }), block('va_change', { VARIABLE: 'score', AMOUNT: '1' }), block('so_play', { SOUND: 'pop' }), block('ga_effect', { HOW: 'a small burst of yellow sparkles where the star was' })],
    [block('ev_when', { EVENT: 'a star reaches the grass without being caught' }), block('va_change', { VARIABLE: 'misses', AMOUNT: '1' }), block('co_if', { CONDITION: 'misses reaches 3' }, [block('ga_over', { HOW: 'and show the final score' })])],
  );
  return p;
}

/** 3D: walk around hills collecting coins. */
export function coinHills(): Project {
  const p = newProject('3d');
  p.title = 'Coin Hills';
  p.notes = 'A small 3D adventure: walk around a grassy island and collect all 10 floating, spinning coins before the timer runs out (60 seconds).';
  const amble = p.sprites[0];
  amble.description = 'The player, a small walking creature (a flat cutout in the 3D world).';
  amble.sounds = [synthSound('coin', 'coin'), synthSound('jump', 'jump')];
  amble.blocks = workspace(
    [
      block('ev_start'),
      block('wo_world', { HOW: 'a green island with gentle hills, a few low-poly trees and rocks, surrounded by blue water' }),
      block('wo_camera', { HOW: 'third person, behind me, smooth' }),
      block('mo_physics', { HOW: 'solid, falls with gravity, does not tip over' }),
      block('mo_control', { CONTROLS: 'WASD or arrow keys to walk and turn; space to jump' }),
    ],
    [block('ev_when', { EVENT: 'I touch a coin' }), block('va_change', { VARIABLE: 'coins', AMOUNT: '1' }), block('so_play', { SOUND: 'coin' }), block('ga_effect', { HOW: 'golden sparkle burst' })],
  );
  p.stage.blocks = workspace(
    [
      block('ev_start'),
      block('va_set', { VARIABLE: 'coins', VALUE: '0' }),
      block('va_show', { VARIABLE: 'coins (out of 10) and time left' }),
      block('wo_build', { WHAT: '10 spinning gold coins floating a little above the ground, spread around the island' }),
    ],
    [block('ga_rule', { RULE: 'collect all 10 coins to win; if the 60 second timer runs out first, it is game over' })],
  );
  const flag = newSprite('Signpost', '3d', [], 3, 0);
  flag.costumes = [
    svgAsset(
      'sign',
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect x="54" y="60" width="12" height="100" rx="3" fill="#8b5a2b" stroke="#4a2f14" stroke-width="3"/><rect x="6" y="8" width="108" height="60" rx="8" fill="#f4d58d" stroke="#4a2f14" stroke-width="4"/><text x="60" y="46" font-family="Trebuchet MS, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="#4a2f14">COINS!</text></svg>`,
      120,
      160,
    ),
  ];
  flag.description = 'A wooden sign near the start that says COINS!';
  flag.blocks = workspace([block('ev_click'), block('lo_say_for', { TEXT: 'Find all 10 coins!', TIME: '2 seconds' })]);
  p.sprites.push(flag);
  return p;
}

/** Blank projects and examples offered in the File menu. */
export const EXAMPLES: Array<{ id: string; title: string; description: string; make(): Project }> = [
  { id: 'star-catcher', title: 'Star Catcher (2D)', description: 'Catch falling stars. The compiler draws the stars.', make: starCatcher },
  { id: 'coin-hills', title: 'Coin Hills (3D)', description: 'Walk an island collecting coins, with physics.', make: coinHills },
];

export function blankProject(mode: '2d' | '3d'): Project {
  const p = newProject(mode);
  p.sprites[0].costumes = ambleCostumes();
  return p;
}
