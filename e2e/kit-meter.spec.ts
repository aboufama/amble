import { expect, test, type Frame, type Page } from '@playwright/test';

// `this.ui.meter(label, value, max)` is the HUD's gauge for any number (a jetpack's fuel, ammo, heat), through
// the player harness (dev/player/). Game code calls it every frame with the number it keeps, or once with a
// function; the gauge follows the number, stacks under the hearts, and shrugs off a NaN.

type Win = Window & {
  harness: { player: { load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>; iframe: HTMLIFrameElement | null } };
};

interface HudObject {
  type: string;
  text?: string;
  active: boolean;
  x: number;
  y: number;
  width: number;
  fillColor?: number;
}

type Hook = {
  __ambleGame: {
    game: { scene: { getScene(key: string): { children: { list: HudObject[] } } } };
    scene: Record<string, unknown>;
  };
};

async function load(page: Page, source: string): Promise<Frame> {
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => !!(window as unknown as { __ambleGame?: { game?: unknown } }).__ambleGame?.game);
  return frame;
}

test('a meter follows the number it shows, stacks under the hearts and survives a NaN', async ({ page }) => {
  test.setTimeout(120_000);
  const frame = await load(
    page,
    `class Game extends Amble.Scene {
  static art = { hero: { kind: 'character', rig: 'biped', role: 'hero', w: 40, h: 64, ask: 'Draw your hero' } };
  create() {
    this.hero = this.spawnHero(200, 300, 'hero');
    this.ui.hearts(this.hero);
    this.fuel = 100;
    this.heat = 2;
    this.ticks = 0;
    this.ui.meter('Heat', () => this.heat, 10, { color: '#ff4d6d' });
  }
  update() {
    this.ticks++;
    if (this.ticks > 10 && this.ticks <= 60) this.fuel = 100 - (this.ticks - 10);
    if (this.ticks === 30) this.fuel = this.missing * 2;
    this.gauge = this.ui.meter('Fuel', this.fuel, 100);
  }
}
`,
  );
  const read = () =>
    frame.evaluate(() => {
      const g = (window as unknown as Hook).__ambleGame;
      const s = g.scene as { ticks: number; gauge: { value: number; max: number } };
      const hud = g.game.scene.getScene('__amble_ui').children.list.filter((o) => o.active);
      const label = (t: string) => hud.find((o) => o.type === 'Text' && o.text === t);
      // The fills are the rectangles 12 px tall whose left edge sits right of the label.
      const bars = hud.filter((o) => o.type === 'Rectangle' && Math.round((o as unknown as { height: number }).height) === 12);
      return {
        ticks: s.ticks,
        value: s.gauge?.value,
        max: s.gauge?.max,
        fuel: label('FUEL') ? { y: label('FUEL')!.y } : null,
        heat: label('HEAT') ? { y: label('HEAT')!.y } : null,
        widths: bars.map((b) => ({ y: Math.round(b.y), w: Math.round(b.width) })),
        texts: hud.filter((o) => o.type === 'Text').map((o) => String(o.text)),
      };
    });
  await expect.poll(async () => (await read()).ticks, { timeout: 60_000 }).toBeGreaterThan(90);
  const r = await read();
  // One gauge per label, however often update() asks for it.
  expect(r.texts.filter((t) => t === 'FUEL')).toHaveLength(1);
  expect(r.texts.filter((t) => t === 'HEAT')).toHaveLength(1);
  expect(r.texts.some((t) => t.includes('NaN'))).toBe(false);
  // Under the hearts (top left, about 28 px down), in the order they were made.
  expect(r.heat!.y).toBeGreaterThan(50);
  expect(r.fuel!.y).toBeGreaterThan(r.heat!.y);
  // Fuel ran down to 50 of 100 (the NaN at frame 30 kept the last number), heat reads 2 of 10.
  expect(r.value).toBe(50);
  expect(r.max).toBe(100);
  const fuelFill = r.widths.find((b) => b.y === Math.round(r.fuel!.y));
  const heatFill = r.widths.find((b) => b.y === Math.round(r.heat!.y));
  expect(fuelFill?.w).toBeGreaterThanOrEqual(73);
  expect(fuelFill?.w).toBeLessThanOrEqual(77);
  expect(heatFill?.w).toBeGreaterThanOrEqual(28);
  expect(heatFill?.w).toBeLessThanOrEqual(32);
});
