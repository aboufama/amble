import { expect, test, type Frame, type Page } from '@playwright/test';

// Game code picks the game's speed: `this.timeScale` ("0.25 = slow motion"), `this.fx.slowmo(scale)` and
// `this.fx.hitstop(ms)`, through the player harness (dev/player/). A ratio with a zero under it hands them
// Infinity or NaN for a moment. The game must keep running at a sane speed once the numbers are sane again: an endless (or huge)
// time step never finishes the physics' catch-up loop, a frozen game, and a NaN one stops its physics for
// good while the rest of the game runs on.

type Win = Window & {
  harness: { player: { load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>; iframe: HTMLIFrameElement | null } };
};

type Hook = { __ambleGame?: { scene: { ticks?: number; ball?: { x: number } } | null } };

/** A ball rolling right at 60 px/s, and `bad` run at frames 3 to 5. */
const game = (bad: string): string => `class Game extends Amble.Scene {
  static art = { ball: { kind: 'item', role: 'item', w: 40, h: 40, shape: 'ellipse', name: 'Ball' } };
  create() {
    this.ball = this.spawn(100, 200, 'ball', { vx: 60 });
    this.ticks = 0;
  }
  update() {
    this.ticks++;
    if (this.ticks >= 3 && this.ticks <= 5) ${bad};
    if (this.ticks === 6) this.timeScale = 1;
  }
}
`;

async function load(page: Page, source: string): Promise<Frame> {
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  return frame;
}

/** The game's frame count and where the ball is, or null when the game does not answer within 5 s. */
async function sample(frame: Frame): Promise<{ ticks: number; x: number } | null> {
  return Promise.race([
    frame.evaluate(() => {
      const s = (window as unknown as Hook).__ambleGame?.scene;
      return s?.ball && s.ticks !== undefined ? { ticks: s.ticks, x: s.ball.x } : null;
    }),
    new Promise<null>((r) => setTimeout(() => r(null), 5000)),
  ]).catch(() => null);
}

const ticks = async (frame: Frame): Promise<number> => (await sample(frame))?.ticks ?? 0;

for (const [label, bad] of [
  ['an endless game speed', 'this.timeScale = 1 / 0'],
  ['a huge game speed', 'this.timeScale = 1e9'],
  ['slow motion at NaN', 'this.fx.slowmo(0 / 0, 2000)'],
  ['an endless hit-stop', 'this.fx.hitstop(1 / 0)'],
] as const) {
  test(`a game given ${label} for a moment keeps running`, async ({ page }) => {
    test.setTimeout(180_000);
    const frame = await load(page, game(bad));
    // Well past the bad frame: a frozen game never gets there.
    await expect.poll(() => ticks(frame), { timeout: 60_000 }).toBeGreaterThan(10);
    // And past the 2 s of slow motion.
    await page.waitForTimeout(3000);
    const a = (await sample(frame))!;
    await expect.poll(() => ticks(frame), { timeout: 60_000 }).toBeGreaterThan(a.ticks + 30);
    const b = (await sample(frame))!;
    // The ball rolls on, at least a pixel a frame (60 px/s): with the physics stopped it would stay put.
    expect(Number.isFinite(b.x)).toBe(true);
    expect(b.x - a.x).toBeGreaterThanOrEqual((b.ticks - a.ticks) * 0.5);
  });
}

test('a hit-stop given NaN leaves hit-stop working for the rest of the game', async ({ page }) => {
  test.setTimeout(180_000);
  // Frame 30 asks for the longest hit-stop: the game clock stands still on the next frame (unless a frame
  // takes over a second). A NaN left behind by frames 3 to 5 would switch hit-stop off for good.
  const source = game('this.fx.hitstop(0 / 0)').replace(
    "if (this.ticks === 6) this.timeScale = 1;",
    'if (this.ticks === 6) this.timeScale = 1;\n    if (this.ticks === 30) { this.fx.hitstop(1000); this.c0 = this.clock; this.r0 = performance.now(); }\n    if (this.ticks === 31) { this.c1 = this.clock; this.r1 = performance.now(); }',
  );
  const frame = await load(page, source);
  await expect.poll(() => ticks(frame), { timeout: 90_000 }).toBeGreaterThan(31);
  const clocks = await frame.evaluate(() => {
    const s = (window as unknown as { __ambleGame?: { scene: { c0?: number; c1?: number; r0?: number; r1?: number } | null } }).__ambleGame?.scene;
    return { c0: s?.c0, c1: s?.c1, realMs: (s?.r1 ?? 0) - (s?.r0 ?? 0) };
  });
  expect(Number.isFinite(clocks.c0)).toBe(true);
  // A frame that took most of the second on a busy machine proves nothing either way.
  test.skip(clocks.realMs > 900, `frame 31 came ${Math.round(clocks.realMs)} ms after frame 30`);
  expect(clocks.c1).toBe(clocks.c0);
});
