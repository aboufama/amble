import { expect, test, type Frame, type Page } from '@playwright/test';

// `hero.animSpeed` is game code's to set (the kit's API documents it), through the player harness
// (dev/player/). A slip there (0/0 while a speed is still undefined) hands the character's moves a NaN time
// step for a frame. The stand-in ("just bones"), and a drawing without bones that plays through the same
// puppet, must look right again as soon as the number does, instead of vanishing for the rest of the run.

type Win = Window & {
  harness: { player: { load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>; iframe: HTMLIFrameElement | null } };
};

type Shape = { scaleX: number; scaleY: number; x: number; y: number; parts: number[] };

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => !!(window as unknown as { __ambleGame?: { game?: unknown } }).__ambleGame?.game);
  return frame;
}

test("a stand-in whose move speed was NaN for one frame shows again", async ({ page }) => {
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  const source = `class Game extends Amble.Scene {
  static art = { hero: { kind: 'character', rig: 'biped', w: 40, h: 64, role: 'hero', name: 'Pip' } };
  create() {
    this.hero = this.spawnHero(300, 300, 'hero');
    this.ticks = 0;
  }
  update() {
    this.ticks++;
    this.hero.animSpeed = this.ticks === 3 ? 0 / 0 : 1;
  }
}
`;
  await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
  const frame = await gameFrame(page);
  const shape = (): Promise<Shape> =>
    frame.evaluate(() => {
      const g = (window as unknown as { __ambleGame: { find(k: string): { visual: { object: { scaleX: number; scaleY: number; x: number; y: number; list: Array<{ x: number; y: number; rotation: number }> } } } | null; scene: { ticks: number } } }).__ambleGame;
      const o = g.find('hero')!.visual.object;
      return { scaleX: o.scaleX, scaleY: o.scaleY, x: o.x, y: o.y, parts: o.list.flatMap((p) => [p.x, p.y, p.rotation]) };
    });
  const ticks = (): Promise<number> => frame.evaluate(() => (window as unknown as { __ambleGame: { scene: { ticks: number } } }).__ambleGame.scene.ticks);
  await expect.poll(ticks, { timeout: 60_000 }).toBeGreaterThan(12);
  const s = await shape();
  expect(s.parts.length).toBeGreaterThan(0);
  expect([s.scaleX, s.scaleY, s.x, s.y, ...s.parts].every((v) => Number.isFinite(v))).toBe(true);
  expect(Math.abs(s.scaleX)).toBeGreaterThan(0.5);
});
