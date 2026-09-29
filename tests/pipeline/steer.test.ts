/** The local matcher (§5.10): a corpus of what students say, with the dial or twist each one moves, or none. */
import { describe, expect, it } from 'vitest';
import type { GameManifest } from '../../src/cores/play';
import type { LocalSteer } from '../../src/model/types';
import { artNeedOf, dialInfoOf } from '../../src/pipeline/manifest';
import { stem, steer, tokens } from '../../src/pipeline/steer';
import { world } from './helpers';

const TWISTS: Array<[string, string]> = [
  ['moonGravity', 'Moon gravity'], ['gravityFlips', 'Gravity flips'], ['giantHero', 'Giant mode'], ['tinyHero', 'Tiny mode'], ['slowmoHits', 'Slow-mo hits'],
  ['slowTime', 'Slow time'], ['bouncyWorld', 'Bouncy world'], ['starRain', 'Rain of stars'], ['enemyParty', 'Enemy party'], ['speedUp', 'Speed-up'],
  ['surpriseBoss', 'Surprise boss'], ['earthquake', 'Earthquake'], ['doubleJump', 'Double jump'],
];

const MANIFEST: GameManifest = {
  title: 'Moon King',
  subtitle: '',
  physics: 'arcade',
  kit: true,
  art: [
    artNeedOf('hero', { kind: 'character', rig: 'biped', role: 'hero', name: 'Pip' }, 0),
    artNeedOf('moonKing', { kind: 'character', rig: 'blob', role: 'boss', name: 'The Moon King' }, 1),
    artNeedOf('grumble', { kind: 'character', rig: 'blob', role: 'enemy', name: 'Grumble' }, 2),
  ],
  dials: [
    dialInfoOf('jump', { label: 'Jump height', value: 720, min: 400, max: 1100, step: 20, words: 'hop bounce float', for: 'hero' }),
    dialInfoOf('bossHp', { label: 'Moon King health', value: 150, min: 50, max: 400, step: 10, live: false, words: 'boss health life', for: 'moonKing' }),
    dialInfoOf('orbSpeed', { label: 'Orb speed', value: 240, min: 120, max: 420, step: 10, words: 'bullets fast slow', for: 'moonKing' }),
    dialInfoOf('grumbles', { label: 'Grumbles', value: 3, min: 1, max: 10, step: 1, words: 'enemies many spawn' }),
    dialInfoOf('gravity', { label: 'Gravity', value: 1500, min: 600, max: 2400, step: 50, words: 'heavy fall' }),
  ],
  twists: TWISTS.map(([id, name]) => ({ id, name, does: '', available: id !== 'surpriseBoss', on: false })),
  controls: [],
};

type Expect = null | { dial: string; to?: number; up?: boolean } | { twist: string; on: boolean };

const CORPUS: Array<[string, Expect]> = [
  // dials: which one, and which way
  ['make the jump floatier', { dial: 'jump', to: 860 }],
  ['jump higher', { dial: 'jump', to: 860 }],
  ['Jump higher!!', { dial: 'jump', to: 860 }],
  ['make the jump a lot higher', { dial: 'jump', to: 1000 }],
  ['make jumping way higher', { dial: 'jump', to: 1000 }],
  ['make the jump a little higher', { dial: 'jump', up: true }],
  ['jump lower', { dial: 'jump', to: 580 }],
  ['set the jump to 900', { dial: 'jump', to: 900 }],
  ['hop higher please', { dial: 'jump', to: 860 }],
  ['make Pip jump higher', { dial: 'jump', to: 860 }],
  ['make the orbs faster', { dial: 'orbSpeed', to: 300 }],
  ['slower orbs', { dial: 'orbSpeed', to: 180 }],
  ['make the bullets slower', { dial: 'orbSpeed', to: 180 }],
  ['half the orb speed', { dial: 'orbSpeed', to: 120 }],
  ['make the moon king weaker', { dial: 'bossHp', to: 80 }],
  ['give the boss more health', { dial: 'bossHp', to: 220 }],
  ['double the boss health', { dial: 'bossHp', to: 300 }],
  ['boss health to 250', { dial: 'bossHp', to: 250 }],
  ['more grumbles', { dial: 'grumbles', up: true }],
  ['fewer enemies', { dial: 'grumbles', to: 1 }],
  ['make gravity heavier', { dial: 'gravity', up: true }],
  ['make the gravity floatier', { dial: 'gravity', up: false }],
  ['lower gravity', { dial: 'gravity', up: false }],
  // twists
  ['flip gravity', { twist: 'gravityFlips', on: true }],
  ['giant mode', { twist: 'giantHero', on: true }],
  ['slow motion when I hit', { twist: 'slowmoHits', on: true }],
  ['moon gravity', { twist: 'moonGravity', on: true }],
  ['turn off moon gravity', { twist: 'moonGravity', on: false }],
  ['make everything bouncy', { twist: 'bouncyWorld', on: true }],
  ['earthquake!', { twist: 'earthquake', on: true }],
  ['double jump', { twist: 'doubleJump', on: true }],
  ['rain of stars', { twist: 'starRain', on: true }],
  ['enemy party', { twist: 'enemyParty', on: true }],
  ['speed up the game', { twist: 'speedUp', on: true }],
  ['no more slow motion', { twist: 'slowmoHits', on: false }],
  ['stop the earthquakes', { twist: 'earthquake', on: false }],
  ['make the hero tiny', { twist: 'tinyHero', on: true }],
  ['turn the world upside down', { twist: 'gravityFlips', on: true }],
  // everything else goes to the AI
  ['make the jump higher and add lava', null],
  ['add a boss', null],
  ['make it more fun', null],
  ['jump', null],
  ['make the moon king throw pizza', null],
  ['speed', null],
  ['make everything faster', null],
  ['make the hero faster', null],
  ['make the jump floaty and the boss weaker', null],
  ['turn the music up', null],
  ['make it harder', null],
  ['make the boss giant', null],
  ['surprise boss', null],
  ['', null],
];

function outcome(s: LocalSteer | null): Expect {
  if (!s) return null;
  return s.kind === 'dial' ? { dial: s.key, to: s.to, up: s.to > s.from } : { twist: s.id, on: s.on };
}

describe('the local matcher', () => {
  it('has a corpus of at least 40 sentences', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CORPUS)('"%s"', (sentence, want) => {
    const got = outcome(steer(sentence, world({ dials: {} }), MANIFEST));
    if (want === null) return expect(got).toBeNull();
    if ('twist' in want) return expect(got).toEqual(want);
    expect(got).not.toBeNull();
    expect(got && 'dial' in got && got.dial).toBe(want.dial);
    if (want.to !== undefined) expect(got && 'to' in got && got.to).toBe(want.to);
    if (want.up !== undefined) expect(got && 'up' in got && got.up).toBe(want.up);
  });

  it('starts from the value the student already set', () => {
    const s = steer('jump higher', world({ dials: { jump: 1000 } }), MANIFEST);
    expect(s).toEqual({ kind: 'dial', key: 'jump', label: 'Jump height', from: 1000, to: 1100 });
  });

  it('never moves a twist the world cannot use', () => {
    expect(steer('surprise boss', world(), MANIFEST)).toBeNull();
  });

  it('stems words the way §5.10 says', () => {
    expect(['higher', 'faster', 'floatier', 'bounciest', 'jumping', 'enemies', 'orbs'].map(stem)).toEqual(['high', 'fast', 'floaty', 'bouncy', 'jump', 'enemy', 'orb']);
    expect(tokens("Make the jump    FLOATIER, please!")).toEqual(['make', 'the', 'jump', 'floatier', 'please']);
  });
});
