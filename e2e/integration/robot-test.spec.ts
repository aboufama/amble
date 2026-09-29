/**
 * The robot test is judged by its progress, not by a flat wall-clock limit: a heavy but healthy game may
 * take its time on a slow machine, a frame that never finishes is stopped in seconds, and a loop that
 * never ends fails fast through its guard. The visible game keeps running meanwhile.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/app';
import { openWorld } from '../world/world';

interface Run {
  ms: number;
  pass: boolean;
  reasons: string[];
  frames: number;
  /** The run's own wall time: from its first frame to its end (or to where the watchdog stopped it). */
  wallMs: number;
  speed: number;
  errors: string[];
}

type Win = Window & {
  __amble: { services: { player: { robot(init: unknown): Promise<{ raw: { frames: number; wallMs: number; speed: number; errors: Array<{ phase: string; message: string }> }; verdict: { pass: boolean; reasons: string[] } }>; player: { state: string } | null } } };
};

/** A small kit game whose `update()` runs `body` every frame (not loop-guarded unless the body is). */
function game(body: string): string {
  return `class Game extends Amble.Scene {
  static config = { title: 'ROBOT', physics: 'arcade', gravity: 1200, background: '#203050' };
  static art = { hero: { kind: 'character', rig: 'biped', role: 'hero', w: 40, h: 64, ask: 'Draw your hero' } };
  create() {
    this.player = this.spawnHero(200, 300, 'hero').platformer();
  }
  update() {
${body}
  }
}
`;
}

async function robot(page: Page, source: string): Promise<Run> {
  return page.evaluate(async (src) => {
    const { DEFAULT_PREFS } = await import(/* @vite-ignore */ `${location.origin}/src/play/protocol.ts`);
    const init = {
      type: 'init', mode: 'robot', files: [{ name: 'game.js', source: src }], art: [], sounds: [], fonts: [], dials: {}, twists: [], storage: {},
      prefs: DEFAULT_PREFS, autostart: true, robot: { gameMs: 6000, seed: 1, bot: 'auto' },
    };
    const t0 = performance.now();
    const r = await (window as unknown as Win).__amble.services.player.robot(init);
    return {
      ms: Math.round(performance.now() - t0),
      pass: r.verdict.pass,
      reasons: r.verdict.reasons,
      frames: r.raw.frames,
      wallMs: r.raw.wallMs,
      speed: r.raw.speed,
      errors: r.raw.errors.map((e) => `${e.phase}: ${e.message}`),
    };
  }, source);
}

const visibleState = (page: Page) => page.evaluate(() => (window as unknown as Win).__amble.services.player.player?.state ?? 'none');

test('a heavy but healthy game takes its time and is not called frozen', async ({ page }) => {
  test.setTimeout(180_000);
  await openWorld(page);
  // Every frame costs 40 ms: 6 s of play takes well over the 10 s the old flat limit allowed.
  const run = await robot(page, game('    const end = performance.now() + 40;\n    while (performance.now() < end) {}'));
  test.info().annotations.push({ type: 'run', description: JSON.stringify(run) });
  expect(run.errors.filter((e) => e.startsWith('frozen'))).toEqual([]);
  expect(run.frames).toBe(360);
  expect(run.wallMs).toBeGreaterThan(10_000);
  expect(run.speed).toBeGreaterThan(0);
  expect(run.speed).toBeLessThan(1);
  expect(await visibleState(page)).not.toBe('crashed');
});

test('a frame that never finishes is stopped within seconds, with the speed it had', async ({ page }) => {
  test.setTimeout(120_000);
  await openWorld(page);
  // After 3 s of play one frame blocks for 12 s (an endless loop, as far as anyone can tell).
  const run = await robot(page, game('    if (this.clock > 3000 && !this.stuck) {\n      this.stuck = true;\n      const end = performance.now() + 12000;\n      while (performance.now() < end) {}\n    }'));
  test.info().annotations.push({ type: 'run', description: JSON.stringify(run) });
  expect(run.pass).toBe(false);
  expect(run.errors).toContainEqual(expect.stringMatching(/^frozen: The game froze: no frame finished for 4 seconds/));
  // Stopped about 4 s after its last finished frame, long before the frame itself would have ended.
  expect(run.wallMs).toBeGreaterThan(3500);
  expect(run.wallMs).toBeLessThan(12_000);
  expect(run.frames).toBeGreaterThan(0);
  expect(run.speed).toBeGreaterThan(0);
  // The visible game may share that renderer process; the watchdog held while the robot played.
  await page.waitForTimeout(8000);
  expect(await visibleState(page)).not.toBe('crashed');
});

test('a loop that never ends fails fast through its guard', async ({ page }) => {
  test.setTimeout(120_000);
  await openWorld(page);
  const run = await robot(page, game('    if (this.clock > 300) {\n      while (true) {\n        Amble.__loop();\n      }\n    }'));
  test.info().annotations.push({ type: 'run', description: JSON.stringify(run) });
  expect(run.pass).toBe(false);
  expect(run.errors.join('\n')).toContain('This loop never stops');
  // The guard stops the loop after 1.5 s of one frame; the run ends there (booting is not counted).
  expect(run.wallMs).toBeLessThan(8000);
});
