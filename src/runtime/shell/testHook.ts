/**
 * `window.__ambleGame`: a read-only view of the running game for Playwright and the robot tools, so tests
 * assert behaviour (state, errors, swaps, objects) rather than pixels. Present in every build: the sandbox
 * holds nothing worth stealing.
 */
import Phaser from 'phaser';
import type { GameState, PlayerError, PlayerPrefs, RuntimeStats } from '../../play/protocol';
import { buildManifest, counters } from '../kit/boot';
import { worldObjects } from '../kit/objects';
import { currentScene } from '../kit/scene';
import { currentGame } from './patches';

export interface TestHookSource {
  state(): GameState;
  errors(): PlayerError[];
  swaps(): number;
  stats(): RuntimeStats;
  dials(): Record<string, number>;
  twists(): string[];
  prefs(): PlayerPrefs;
  /** When the flash limiter let flashes through. */
  flashes(): number[];
}

/** The first live thing showing an art key (a kit character or sprite, or a plain image). */
function findByKey(key: string): Phaser.GameObjects.GameObject | null {
  const game = currentGame();
  if (!game) return null;
  for (const scene of game.scene.getScenes(true)) {
    for (const o of scene.children.list) {
      const k = (o as { key?: unknown }).key;
      const tex = (o as { texture?: Phaser.Textures.Texture }).texture?.key;
      if (o.active && (k === key || tex === key || tex === key + '~hd')) return o;
    }
  }
  return null;
}

export function installTestHook(src: TestHookSource): void {
  Object.defineProperty(window, '__ambleGame', {
    configurable: false,
    value: Object.freeze({
      get state() {
        return src.state();
      },
      get scene() {
        return currentScene();
      },
      get game() {
        return currentGame();
      },
      find: findByKey,
      all: (group: string) => currentScene()?.all(group) ?? [],
      stats: () => src.stats(),
      manifest: buildManifest,
      get errors() {
        return src.errors();
      },
      get swaps() {
        return src.swaps();
      },
      get createCount() {
        return counters.creates;
      },
      /** The things on screen, as the editor's Change mode sees them. */
      objects: () => {
        const game = currentGame();
        return game ? worldObjects(game) : [];
      },
      dial: (name: string) => src.dials()[name],
      twists: () => src.twists(),
      prefs: () => src.prefs(),
      flashes: () => src.flashes(),
    }),
  });
}
