import { expect, test, type Page } from '@playwright/test';

// The kit's music plays at the tempo game code asks for (`this.music.play('chase', { bpm })`), through the
// player harness (dev/player/). Whatever number arrives there, the game must keep running: the scheduler is
// kit code, out of reach of the loop guard, and the robot test never plays music, so a hang there would pass
// every check and then freeze the student's world as soon as its sound is on.

interface LogEntry {
  t: number;
  type: string;
  data: unknown;
}

type Win = Window & {
  harness: {
    player: { load(b: { files: Array<{ name: string; source: string }>; autostart?: boolean }): Promise<void>; iframe: HTMLIFrameElement | null };
    log: LogEntry[];
  };
};

const count = (page: Page, type: string, data?: unknown): Promise<number> =>
  page.evaluate(([t, d]) => (window as unknown as Win).harness.log.filter((l) => l.type === t && (d === undefined || l.data === d)).length, [type, data] as const);

for (const [label, tempo] of [
  ['a negative tempo', '-120'],
  ['an endless tempo', 'Infinity'],
  ['a huge tempo', '1e9'],
] as const) {
  test(`music asked for at ${label} keeps the game running`, async ({ page }) => {
    await page.goto('/dev/player/index.html');
    await page.waitForFunction(() => !!(window as unknown as Win).harness);
    const source = `class Game extends Amble.Scene {\n  create() {\n    this.music.play('chase', { bpm: ${tempo} });\n    this.add.text(40, 40, 'tempo test');\n  }\n}\n`;
    await page.evaluate((src) => (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }], autostart: true }), source);
    // A click in the game is the gesture that turns its sound on.
    const box = (await page.locator('iframe.amble-player-frame').last().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => count(page, 'audio', 'running'), { timeout: 15_000 }).toBeGreaterThan(0);
    // The game reports its stats every second while it runs; a frozen game goes quiet.
    const before = await count(page, 'stats');
    await page.waitForTimeout(3500);
    expect(await count(page, 'stats')).toBeGreaterThanOrEqual(before + 2);
    expect(await count(page, 'error')).toBe(0);
  });
}
