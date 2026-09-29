/**
 * Test games for the player core (ported from the games probe): a boss fight, a Matter physics toy, an
 * endless runner, a broken game (error mapping), a plain Phaser game (no kit) and a strobe (flash limiter).
 */
import boss from './boss.js?raw';
import broken from './broken.js?raw';
import chaos from './chaos.js?raw';
import plain from './plain.js?raw';
import runner from './runner.js?raw';
import strobe from './strobe.js?raw';

export const FIXTURES = { boss, chaos, runner, broken, plain, strobe } as const;

export type FixtureName = keyof typeof FIXTURES;
