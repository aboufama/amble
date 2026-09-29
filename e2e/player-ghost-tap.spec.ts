import { expect, test, type Frame, type Page } from '@playwright/test';

// The ghost loop from inside the game (src/runtime/editor/play.ts), through the player harness
// (dev/player/): once the editor says Play mode, a tap on a "just bones" thing while the game runs pauses
// it and names it (`artClicked`), so the student can go and draw it. Only games that read the pointer
// themselves keep their taps. And a game rebuilt after it left its page (game code's `location.reload()`
// for "press R to restart") must still have its ghost loop.

interface LogEntry {
  t: number;
  type: string;
  data: unknown;
}

type Win = Window & {
  harness: {
    player: {
      load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>;
      setMode(m: 'play' | 'change'): void;
      resume(): void;
      iframe: HTMLIFrameElement | null;
    };
    log: LogEntry[];
  };
};

type Hook = { __ambleGame?: { scene: { ticks?: number } | null } };

/** A crate in the middle of the view, and nothing that reads the pointer. */
const CRATE = `class Game extends Amble.Scene {
  static art = { crate: { kind: 'prop', role: 'prop', w: 180, h: 180, name: 'Crate' } };
  create() {
    this.crate = this.spawn(this.cameras.main.centerX, this.cameras.main.centerY, 'crate', { static: true });
    this.ticks = 0;
  }
  update() {
    this.ticks++;
  }
}
`;

/** The same, in a game whose taps are gameplay. */
const TAPPY = CRATE.replace('this.ticks = 0;', "this.ticks = 0;\n    this.taps = 0;\n    this.input.on('pointerdown', () => this.taps++);");

async function start(page: Page, source: string): Promise<Frame> {
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
  const frame = await running(page);
  // What the editor does after every load.
  await page.evaluate(() => (window as unknown as Win).harness.player.setMode('play'));
  return frame;
}

async function running(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => ((window as unknown as Hook).__ambleGame?.scene?.ticks ?? 0) > 10, null, { timeout: 60_000 });
  return frame;
}

const clicks = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Win).harness.log.filter((l) => l.type === 'artClicked').map((l) => (l.data as { key: string }).key));

/** Taps the middle of the view, where the crate is. */
async function tapCrate(page: Page): Promise<void> {
  const box = (await page.locator('#stage iframe:visible').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

/** Taps the crate until it is named (the mode message and the tap race on a busy machine), at most 10 s. */
async function tapUntilNamed(page: Page, before: number): Promise<string[]> {
  for (let i = 0; i < 10 && (await clicks(page)).length <= before; i++) {
    await tapCrate(page);
    await page.waitForTimeout(1000);
  }
  return clicks(page);
}

test.describe('a tap on a stand-in while the game runs', () => {
  test.setTimeout(240_000);

  test('asks for its drawing', async ({ page }) => {
    await start(page, CRATE);
    expect(await tapUntilNamed(page, 0)).toEqual(['crate']);
  });

  test('is left to a game that reads the pointer', async ({ page }) => {
    const frame = await start(page, TAPPY);
    // Long after the mode message.
    await page.waitForTimeout(3000);
    await tapCrate(page);
    await expect.poll(() => frame.evaluate(() => (window as unknown as { __ambleGame: { scene: { taps: number } } }).__ambleGame.scene.taps), { timeout: 15_000 }).toBe(1);
    expect(await clicks(page)).toEqual([]);
  });

  test('still asks after the game was rebuilt for leaving its page', async ({ page }) => {
    const first = await start(page, CRATE);
    expect(await tapUntilNamed(page, 0)).toEqual(['crate']);
    await page.evaluate(() => (window as unknown as Win).harness.player.resume());
    // The game leaves its page; the Player rebuilds it, running again in a new frame.
    await first.evaluate(() => {
      location.href = 'about:blank';
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const log = (window as unknown as Win).harness.log;
            const at = log.findIndex((l) => l.type === 'navigated');
            return at >= 0 && log.slice(at).some((l) => l.type === 'state' && l.data === 'running');
          }),
        { timeout: 60_000 },
      )
      .toBe(true);
    await running(page);
    expect(await tapUntilNamed(page, 1)).toEqual(['crate', 'crate']);
  });
});
