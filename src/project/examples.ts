import { ambleCostumes, block, character, newProject, newSprite, svgAsset, synthSound, variable, workspace } from './defaults';
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

const starSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><path d="M22 3l5.6 11.9 13 1.6-9.6 9 2.5 12.9L22 32l-11.5 6.4 2.5-12.9-9.6-9 13-1.6z" fill="#ffd84d" stroke="#c98a00" stroke-width="3" stroke-linejoin="round"/><path d="M22 10l3 6.6 7.1.9-5.2 4.9" fill="none" stroke="#fff6c2" stroke-width="2.5" stroke-linecap="round"/></svg>`;

/**
 * Catch falling stars. Almost every block is exact, so the game compiles in an instant;
 * two blocks are in the author's own words (the sparkles and the twinkling).
 */
export function starCatcher(): Project {
  const p = newProject();
  p.title = 'Star Catcher';
  p.stage.costumes = [svgAsset('night sky', nightSky, 480, 360)];
  p.variables = ['score', 'misses'];
  p.stage.blocks = workspace(
    block('br_game', { WHAT: 'catch the falling stars before they reach the grass' }),
    block('br_audience', { WHO: 'kids who are 6 to 10' }),
    block('br_style', { STYLE: 'a cute night sky with glowing yellow stars' }),
    block('br_lose', { COND: block('cd_compare', { A: variable('misses'), OP: '=', B: '3' }) }),
    [block('ev_start'), block('mem_set', { VARIABLE: 'score', VALUE: '0' }), block('mem_set', { VARIABLE: 'misses', VALUE: '0' }), block('va_show', { VARIABLE: 'score' }), block('va_show', { VARIABLE: 'misses' })],
  );

  const amble = p.sprites[0];
  amble.y = -130;
  amble.description = 'The catcher. Walks along the grass.';
  amble.blocks = workspace(
    [block('ev_start'), block('mv_goto_xy', { X: 0, Y: -130 }), block('kit_walk', { KEYS: 'left and right arrows', SPEED: 280 }), block('lk_animate', { FPS: 8 })],
    [block('ev_touch', { WHO: character('Star') }), block('so_play', { SOUND: 'pop' }), block('ga_effect', { HOW: 'a small burst of yellow sparkles' })],
    block('ru_check', { COND: block('cd_compare', { A: variable('score'), OP: '>', B: '-1' }) }),
  );

  const star = newSprite('Star', [svgAsset('star', starSvg, 44, 44)], 0, 190);
  star.description = 'A falling star.';
  star.blocks = workspace(
    [block('ev_start'), block('lo_hide'), block('co_forever', {}, [block('cp_make', { WHO: 'me' }), block('fl_wait', { SECONDS: block('nm_random', { A: 0.6, B: 1.3 }) })])],
    [
      block('ev_created'),
      block('mv_goto_xy', { X: block('nm_random', { A: -210, B: 210 }), Y: 190 }),
      block('lo_show'),
      block('fl_repeat_until', { COND: block('cd_compare', { A: block('nm_my', { PROP: 'y' }), OP: '<', B: '-165' }) }, [
        block('mv_move', { DIR: 'down', STEPS: block('nm_math', { A: 3, OP: '+', B: block('nm_math', { A: variable('score'), OP: '÷', B: 5 }) }) }),
        block('fl_if', { COND: block('cd_touching', { WHO: character('Amble') }) }, [block('mem_change', { VARIABLE: 'score', AMOUNT: 1 }), block('co_delete_clone')]),
      ]),
      block('mem_change', { VARIABLE: 'misses', AMOUNT: 1 }),
      block('co_delete_clone'),
    ],
    block('ru_always', { RULE: 'twinkle and spin slowly as I fall' }),
  );
  p.sprites.push(star);
  return p;
}

// -----------------------------------------------------------------------------
// Demos written mostly in words. Each has a brief, a few characters with their own art, and
// rules and actions in plain sentences; exact blocks only where they're the clearest way to say it
// (controls, a score on screen). The compiler writes the rest, and makes whatever art they need.
// -----------------------------------------------------------------------------

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

const gradientBackdrop = (top: string, bottom: string, extra = '') =>
  svg(480, 360, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="480" height="360" fill="url(#g)"/>${extra}`);

/** A steering arcade game: a comet weaves through waves of asteroids. */
export function neonDrift(): Project {
  const p = newProject();
  p.title = 'Neon Drift';
  p.variables = [];
  p.stage.costumes = [svgAsset('deep space', gradientBackdrop('#12052e', '#3a0f5c', '<g fill="#fff" opacity="0.7"><circle cx="60" cy="50" r="1.2"/><circle cx="170" cy="120" r="1"/><circle cx="300" cy="40" r="1.4"/><circle cx="410" cy="90" r="1"/><circle cx="90" cy="200" r="1.1"/><circle cx="380" cy="210" r="1.3"/></g>'), 480, 360)];
  p.stage.blocks = workspace(
    block('br_game', { WHAT: 'steer a tiny comet through a neon asteroid storm and survive as long as you can' }),
    block('br_audience', { WHO: 'anyone who likes quick arcade games' }),
    block('br_style', { STYLE: 'synthwave: deep purple space, a glowing pink and cyan grid scrolling toward the horizon, soft bloom on everything bright' }),
    block('br_lose', { COND: block('cd_words', { TEXT: 'the comet has no lives left' }) }),
    block('ga_rule', { RULE: 'every 15 seconds a new wave starts: asteroids come faster and more often, and a big glowing "WAVE 2" (3, 4...) banner sweeps across the screen' }),
    block('ga_rule', { RULE: 'now and then a golden star drifts by; if the comet catches it, every asteroid on screen bursts into confetti' }),
    block('ga_rule', { RULE: 'the score counts the seconds survived, shown big and glowing at the top center' }),
  );

  const comet = p.sprites[0];
  comet.name = 'Comet';
  comet.description = 'The player: a tiny bright comet.';
  comet.costumes = [
    svgAsset(
      'comet',
      svg(
        64,
        40,
        '<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22e4ff" stop-opacity="0"/><stop offset="1" stop-color="#22e4ff" stop-opacity="0.9"/></linearGradient><radialGradient id="h" cx="0.45" cy="0.4" r="0.6"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#9ff6ff"/><stop offset="1" stop-color="#19c3e6"/></radialGradient></defs><path d="M2 20Q24 8 46 9V31Q24 32 2 20z" fill="url(#t)"/><circle cx="46" cy="20" r="13" fill="url(#h)" stroke="#0b6f8a" stroke-width="2.5"/><circle cx="42" cy="15" r="3.5" fill="#fff" opacity="0.85"/>',
      ),
      64,
      40,
      { x: 46, y: 20 },
    ),
  ];
  comet.sounds = [synthSound('hit', 'hit'), synthSound('powerup', 'powerup')];
  comet.x = -150;
  comet.y = 0;
  comet.rotationStyle = 'all around';
  comet.blocks = workspace(
    block('ru_always', { RULE: 'glide smoothly toward the mouse, tilting the way I move, with a long glowing cyan trail behind me' }),
    block('ga_rule', { RULE: 'the comet has 3 lives, shown as little glowing hearts at the top right' }),
    block('ru_never', { RULE: 'leave the screen' }),
    [block('ev_touch', { WHO: character('Asteroid') }), block('so_play', { SOUND: 'hit' }), block('kit_shake'), block('ga_effect', { HOW: 'a burst of hot pink sparks' }), block('ga_do', { ACTION: "lose a life and blink for 1 second; asteroids can't hurt me while I blink" })],
  );

  const asteroid = newSprite(
    'Asteroid',
    [
      svgAsset(
        'rock',
        svg(
          60,
          56,
          '<path d="M14 6L34 3L50 10L57 26L52 44L36 53L18 50L5 38L4 20z" fill="#5a3f8f" stroke="#ff4fd8" stroke-width="3" stroke-linejoin="round"/><path d="M14 6L34 3L50 10L44 16L26 13z" fill="#7a5ab8"/><circle cx="22" cy="28" r="6" fill="#43306e" stroke="#ff4fd8" stroke-width="1.5"/><circle cx="40" cy="37" r="4.5" fill="#43306e"/><circle cx="38" cy="19" r="3" fill="#43306e"/>',
        ),
        60,
        56,
      ),
    ],
    260,
    0,
  );
  asteroid.description = 'A spinning space rock with a neon pink rim.';
  asteroid.rotationStyle = 'all around';
  asteroid.blocks = workspace(
    [block('ev_start'), block('lo_hide'), block('co_forever', {}, [block('cp_make', { WHO: 'me' }), block('fl_wait', { SECONDS: block('nm_words', { TEXT: 'a little less time each wave, starting at 1 second' }) })])],
    [
      block('ev_created'),
      block('ga_do', { ACTION: 'start just past the right edge at a random height, with a random size and spin' }),
      block('lo_show'),
      block('fl_repeat_until', { COND: block('cd_words', { TEXT: "I'm past the left edge" }) }, [block('ga_do', { ACTION: "drift left at this wave's speed, spinning" })]),
      block('co_delete_clone'),
    ],
  );
  p.sprites.push(asteroid);
  return p;
}

/** A platformer in the dark: the level, the lantern light and the crystals are all words. */
export function lanternCave(): Project {
  const p = newProject();
  p.title = 'Lantern Cave';
  p.stage.costumes = [svgAsset('cave', gradientBackdrop('#0b1026', '#1d2a44'), 480, 360)];
  p.stage.blocks = workspace(
    block('br_game', { WHAT: 'explore a dark cave with a lantern, find the 5 glowing crystals, then reach the exit' }),
    block('br_audience', { WHO: 'kids who are 7 to 12' }),
    block('br_style', { STYLE: 'cozy dark cave: deep blue-black rock, chunky rounded ledges, a warm orange lantern glow, crystals that shine teal and pink' }),
    block('br_win', { COND: block('cd_words', { TEXT: 'Amble has all 5 crystals and is touching the exit door' }) }),
    block('ga_rule', { RULE: 'the cave is a wide level, four screens long, with rocky ledges at different heights, a few gaps to jump over, and a glowing exit door at the far right end' }),
    block('ga_rule', { RULE: '5 crystals sit on ledges around the cave; touching one collects it with a chime and a burst of light, and "crystals: 2 / 5" shows at the top left' }),
    block('ga_rule', { RULE: 'a few bats flap in little loops under the ceiling; if one touches Amble, Amble gets knocked back with a squeak' }),
  );

  const amble = p.sprites[0];
  amble.description = 'The explorer: a small, friendly walking creature holding a lantern.';
  amble.sounds = [synthSound('jump', 'jump'), synthSound('chime', 'coin')];
  amble.x = -180;
  amble.y = -60;
  amble.blocks = workspace(
    [block('ev_start'), block('kit_gravity'), block('kit_walk', { KEYS: 'left and right arrows', SPEED: 220 }), block('kit_jump', { KEY: 'space', POWER: 680 }), block('kit_follow'), block('lk_animate', { FPS: 8 })],
    block('ru_always', { RULE: 'carry a lantern: the cave is dark except a warm, gently flickering circle of light around me' }),
    block('ru_never', { RULE: 'fall out of the level: if I drop below the cave floor, come back at the start' }),
    [block('ev_key', { KEY: 'space' }), block('so_play', { SOUND: 'jump' })],
  );
  return p;
}

/** A physics toy with no rules to lose by: click to drop things on a tiny planet with its own gravity. */
export function pocketPlanet(): Project {
  const p = newProject();
  p.title = 'Pocket Planet';
  p.stage.costumes = [svgAsset('lilac sky', gradientBackdrop('#2a2350', '#7a6bb8', '<g fill="#fff8d6" opacity="0.8"><circle cx="50" cy="60" r="1.6"/><circle cx="140" cy="30" r="1.2"/><circle cx="420" cy="50" r="1.8"/><circle cx="380" cy="300" r="1.3"/><circle cx="70" cy="290" r="1.4"/><circle cx="260" cy="20" r="1"/></g>'), 480, 360)];
  p.stage.sounds = [synthSound('pop', 'pop')];
  p.stage.blocks = workspace(
    block('br_game', { WHAT: 'a tiny planet with its own gravity: click anywhere to drop something and watch it tumble down onto the planet' }),
    block('br_audience', { WHO: 'little kids who like to play without rules' }),
    block('br_style', { STYLE: 'soft pastel storybook: a starry lilac sky, round friendly shapes, gentle shadows' }),
    block('ga_rule', { RULE: 'gravity pulls everything toward the center of the Planet, not down the screen' }),
    [block('ev_stage_click'), block('so_play', { SOUND: 'pop' }), block('ga_do', { ACTION: 'drop a random little thing where I clicked: a cat, a rock, a pine tree or a tiny house, each with its own weight and bounciness' })],
    [block('ev_key', { KEY: 'space' }), block('ga_do', { ACTION: 'everything resting on the Planet hops up a little, then falls back down' })],
    [block('ev_key', { KEY: 'c' }), block('ga_do_for', { ACTION: 'everything that was dropped floats away into space and fades out', SECONDS: 2 })],
  );

  const planet = p.sprites[0];
  planet.name = 'Planet';
  planet.description = 'A tiny round planet with grassy patches. Everything falls toward it.';
  planet.costumes = [
    svgAsset(
      'planet',
      svg(
        180,
        180,
        '<defs><radialGradient id="p" cx="0.38" cy="0.32" r="0.75"><stop offset="0" stop-color="#bdf0c4"/><stop offset="0.7" stop-color="#6fcf8a"/><stop offset="1" stop-color="#3f9a63"/></radialGradient></defs><circle cx="90" cy="90" r="84" fill="url(#p)" stroke="#2f6b4a" stroke-width="4"/><path d="M40 60c14-10 34-8 40 4s-6 22-22 22-30-14-18-26z" fill="#9adf7a"/><path d="M104 120c18-6 40 0 42 14s-20 18-34 12-22-20-8-26z" fill="#9adf7a"/><path d="M118 40c10-2 22 4 22 12s-12 10-20 6-10-16-2-18z" fill="#a7e8ff" opacity="0.8"/><ellipse cx="64" cy="40" rx="18" ry="8" fill="#fff" opacity="0.35" transform="rotate(-25 64 40)"/>',
      ),
      180,
      180,
    ),
  ];
  planet.sounds = [];
  planet.x = 0;
  planet.y = -40;
  planet.rotationStyle = 'all around';
  planet.blocks = workspace(
    [block('ev_start'), block('mo_physics', { HOW: 'a solid round planet that never moves; things land on it and rest on its surface' })],
    block('ru_always', { RULE: 'turn very slowly, and things resting on me turn along with me' }),
    [block('ev_click'), block('ga_do_for', { ACTION: 'wobble like jelly', SECONDS: 1 })],
  );

  const moon = newSprite(
    'Moon',
    [
      svgAsset(
        'moon',
        svg(
          44,
          44,
          '<circle cx="22" cy="22" r="19" fill="#fff4c4" stroke="#c9a94a" stroke-width="3"/><circle cx="15" cy="16" r="3.5" fill="#efdb94"/><circle cx="29" cy="27" r="4.5" fill="#efdb94"/><circle cx="16" cy="29" r="2" fill="#efdb94"/><path d="M17 22q5 4 10 0" fill="none" stroke="#8a6d1f" stroke-width="2" stroke-linecap="round"/>',
        ),
        44,
        44,
      ),
    ],
    150,
    90,
  );
  moon.description = 'A sleepy little moon that circles the Planet.';
  moon.blocks = workspace(block('ru_always', { RULE: 'circle around the Planet once every 12 seconds, smiling, and pull dropped things a tiny bit toward me as I pass' }));
  p.sprites.push(moon);
  return p;
}

/** A gentle one-button flyer: a sky whale eats stars while the sky turns from sunset to night. */
export function skyWhale(): Project {
  const p = newProject();
  p.title = 'Sky Whale';
  p.variables = ['score'];
  p.stage.costumes = [svgAsset('sunset', gradientBackdrop('#ff9a6b', '#7b5fc7'), 480, 360)];
  p.stage.blocks = workspace(
    block('br_game', { WHAT: 'a sleepy sky whale swims through the clouds at dusk, eating stars and dodging storm clouds' }),
    block('br_audience', { WHO: 'kids who are 5 to 9' }),
    block('br_style', { STYLE: 'dreamy watercolor sky that slowly turns from sunset orange to a starry night, with soft layered clouds' }),
    block('br_lose', { COND: block('cd_words', { TEXT: 'the whale has no hearts left' }) }),
    block('ga_rule', { RULE: 'the world scrolls left, a little faster over time; clouds drift by in three layers at different speeds' }),
    block('ga_rule', { RULE: 'stars float by in gentle waves; eating one adds 1 to the score with a soft twinkle' }),
    block('ga_rule', { RULE: 'after 20 seconds, grumpy storm clouds with little lightning sparks start drifting in; touching one costs a heart. The whale has 3 hearts, shown at the top right' }),
    [block('ev_start'), block('mem_set', { VARIABLE: 'score', VALUE: '0' }), block('va_show', { VARIABLE: 'score' })],
  );

  const whale = p.sprites[0];
  whale.name = 'Whale';
  whale.description = 'The player: a round, sleepy blue whale who swims through the sky.';
  whale.costumes = [
    svgAsset(
      'whale',
      svg(
        112,
        72,
        '<path d="M14 30C4 18 2 10 6 6c6 2 10 10 12 18 4-8 10-14 18-14-2 8-8 16-16 22z" fill="#4f8fe0" stroke="#22477a" stroke-width="3" stroke-linejoin="round"/><path d="M20 38c8-20 34-30 60-28 18 2 28 14 28 28 0 16-16 28-46 28-24 0-42-10-42-28z" fill="#5fa3f0" stroke="#22477a" stroke-width="3.5" stroke-linejoin="round"/><path d="M34 50c14 8 42 10 66-2-4 10-18 16-36 16-14 0-24-6-30-14z" fill="#d9ecff"/><path d="M56 44c4 10 12 12 18 8" fill="none" stroke="#22477a" stroke-width="3" stroke-linecap="round"/><circle cx="88" cy="32" r="4" fill="#1b2f52"/><circle cx="89.5" cy="30.5" r="1.3" fill="#fff"/><ellipse cx="96" cy="42" rx="5" ry="3" fill="#ff9bb3" opacity="0.7"/><path d="M70 10c0-6 4-8 6-8" fill="none" stroke="#9fd0ff" stroke-width="3" stroke-linecap="round"/>',
      ),
      112,
      72,
    ),
  ];
  whale.sounds = [synthSound('twinkle', 'blip'), synthSound('bump', 'hit')];
  whale.x = -140;
  whale.y = 0;
  whale.rotationStyle = 'all around';
  whale.blocks = workspace(
    [block('ev_hold', { KEY: 'space' }), block('ga_do', { ACTION: 'swim upward gently' })],
    block('ru_always', { RULE: "sink slowly when I'm not swimming up, and tilt a little with my speed" }),
    block('ru_never', { RULE: 'leave the top or the bottom of the screen' }),
    [block('ev_click'), block('ga_do_for', { ACTION: 'blow a fountain of sparkly water from my blowhole', SECONDS: 1 })],
  );
  return p;
}

/** Blank projects and examples offered in the File menu. */
export const EXAMPLES: Array<{ id: string; title: string; description: string; make(): Project }> = [
  { id: 'neon-drift', title: 'Neon Drift', description: 'Steer a comet through a neon asteroid storm. Waves, lives and power-ups are all words.', make: neonDrift },
  { id: 'lantern-cave', title: 'Lantern Cave', description: 'A platformer in the dark: the level, the lantern light, bats and crystals are all words.', make: lanternCave },
  { id: 'sky-whale', title: 'Sky Whale', description: 'Hold space to swim up. A sky that turns to night, stars to eat and storms to dodge.', make: skyWhale },
  { id: 'pocket-planet', title: 'Pocket Planet', description: 'Click to drop things on a tiny planet with its own gravity. A physics toy.', make: pocketPlanet },
  { id: 'star-catcher', title: 'Star Catcher', description: 'Catch the falling stars. Almost all exact blocks, so it plays instantly.', make: starCatcher },
];

export function blankProject(): Project {
  const p = newProject();
  p.sprites[0].costumes = ambleCostumes();
  return p;
}
