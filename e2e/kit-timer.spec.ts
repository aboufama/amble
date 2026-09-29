import { expect, test, type Frame, type Page } from '@playwright/test';

// `this.ui.timer(seconds, onDone)` is game code's countdown, through the player harness (dev/player/). Game
// code picks its numbers: a time limit it never set (`this.timeLimit` is undefined) or a bonus added before
// it exists (`t.left += this.extra`) turns the count into NaN. The HUD must not show "NaN" for the rest of
// the run with the countdown never ending, and a timer the game stops must stop costing a frame hook.

type Win = Window & {
  harness: { player: { load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>; iframe: HTMLIFrameElement | null } };
};

type Hook = {
  __ambleGame: {
    game: { scene: { getScene(key: string): { children: { list: Array<{ type: string; text?: string; active: boolean }> } } } };
    scene: Record<string, unknown> & { __kit: { postFns: unknown[] } };
  };
};

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => !!(window as unknown as { __ambleGame?: { game?: unknown } }).__ambleGame?.game);
  return frame;
}

async function load(page: Page, source: string): Promise<Frame> {
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
  return gameFrame(page);
}

test('a countdown whose seconds are not a number ends, and one given a NaN bonus keeps counting', async ({ page }) => {
  const frame = await load(
    page,
    `class Game extends Amble.Scene {
  create() {
    this.ended = 0;
    this.limit = this.ui.timer(this.timeLimit, () => { this.ended++; });
    this.bonus = this.ui.timer(30);
    this.bonus.left += this.extra;
    this.ticks = 0;
  }
  update() {
    this.ticks++;
  }
}
`,
  );
  const read = (): Promise<{ ticks: number; ended: number; limit: number; bonus: number; hud: string[] }> =>
    frame.evaluate(() => {
      const g = (window as unknown as Hook).__ambleGame;
      const s = g.scene as unknown as { ticks: number; ended: number; limit: { left: number }; bonus: { left: number } };
      const hud = g.game.scene.getScene('__amble_ui').children.list.filter((o) => o.type === 'Text' && o.active).map((o) => String(o.text));
      return { ticks: s.ticks, ended: s.ended, limit: s.limit.left, bonus: s.bonus.left, hud };
    });
  await expect.poll(async () => (await read()).ticks, { timeout: 60_000 }).toBeGreaterThan(20);
  const r = await read();
  expect(r.hud.filter((t) => t.includes('NaN'))).toEqual([]);
  expect(r.ended).toBe(1);
  expect(r.limit).toBe(0);
  expect(Number.isFinite(r.bonus)).toBe(true);
  expect(r.bonus).toBeGreaterThan(20);
  expect(r.bonus).toBeLessThan(30);
});

test('a countdown the game stops no longer runs every frame', async ({ page }) => {
  const frame = await load(
    page,
    `class Game extends Amble.Scene {
  create() {
    this.ticks = 0;
    this.hooks = [];
  }
  update() {
    this.ticks++;
    if (this.ticks === 5) {
      this.hooks.push(this.__kit.postFns.length);
      for (let i = 0; i < 40; i++) this.ui.timer(10).stop();
      this.hooks.push(this.__kit.postFns.length);
    }
  }
}
`,
  );
  const read = (): Promise<{ ticks: number; hooks: number[] }> =>
    frame.evaluate(() => {
      const s = (window as unknown as Hook).__ambleGame.scene as unknown as { ticks: number; hooks: number[] };
      return { ticks: s.ticks, hooks: s.hooks.slice() };
    });
  await expect.poll(async () => (await read()).ticks, { timeout: 60_000 }).toBeGreaterThan(8);
  const { hooks } = await read();
  expect(hooks.length).toBe(2);
  expect(hooks[1]).toBe(hooks[0]);
});
