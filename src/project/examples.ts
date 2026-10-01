import { ambleCostumes, block, character, newProject, newSprite, svgAsset, variable, workspace } from './defaults';
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

/** Blank projects and examples offered in the File menu. */
export const EXAMPLES: Array<{ id: string; title: string; description: string; make(): Project }> = [
  { id: 'star-catcher', title: 'Star Catcher', description: 'Catch the falling stars. Almost all exact blocks.', make: starCatcher },
];

export function blankProject(): Project {
  const p = newProject();
  p.sprites[0].costumes = ambleCostumes();
  return p;
}
