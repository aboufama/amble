import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * End-to-end: press Compile with a mocked OpenAI API, check that compiled code, a compiled
 * sprite and compiled art arrive, then play the game with the keyboard.
 */

const ambleCode = `class Amble extends Sprite {
  start() {
    this.speed = 240;
    this.setPosition(-120, -100);
    this.animate(['amble-a', 'amble-b'], 6);
    this.say("Hi! I'm Amble.");
    this.after(1.5, () => this.say(''));
  }
  update(dt) {
    const dir = this.game.input.axis('horizontal');
    this.x += dir * this.speed * dt;
    if (dir) this.flipX = dir < 0;
    this.keepOnStage();
    const coin = this.touching('Coin');
    if (coin) {
      coin.destroy();
      this.game.vars.score += 1;
      this.playSound('pop');
      this.game.effects.burst({ x: coin.x, y: coin.y });
    }
    window.__test = { x: this.x, y: this.y, score: this.game.vars.score, time: this.game.time };
  }
  onKeyDown(key) {
    if (key === 'space') {
      this.say('jump!');
      this.wait(0.3);
      this.say('');
    }
  }
}`;

const stageCode = `class StageScript extends Stage {
  start() {
    this.game.vars.score = 0;
    this.game.ui.value('Score', () => this.game.vars.score);
  }
}`;

const coinCode = `class Coin extends Sprite {
  start() {
    this.setPosition(60, -100);
  }
  update(dt) {
    this.turn(90 * dt);
  }
}`;

const compileReply = {
  summary: 'Amble walks left and right collecting a coin.',
  howToPlay: 'Use the arrow keys to walk. Grab the coin!',
  sprites: [{ name: 'Coin', description: 'A spinning gold coin', x: 60, y: -100, z: 0, size: 100, direction: 0, visible: true }],
  assets: [{ target: 'Coin', kind: 'costume', name: 'coin', description: 'a shiny gold coin with a star', width: 40, height: 40, reuse: false }],
  code: [
    { target: 'Amble', source: ambleCode },
    { target: 'Stage', source: stageCode },
    { target: 'Coin', source: coinCode },
  ],
  warnings: ['Picked a walking speed of 240 px/s.'],
};

const coinSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="#ffd21f" stroke="#a87b00" stroke-width="4"/><path d="M20 10l3 7h7l-6 4 2 8-6-5-6 5 2-8-6-4h7z" fill="#fff3a8"/></svg>';

function sse(content: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += 400) {
    chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(i, i + 400) }, finish_reason: null }] })}\n\n`);
  }
  chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return chunks.join('');
}

async function mockOpenAI(page: Page, calls: string[]) {
  await page.route('https://api.openai.com/v1/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    const name: string = body.response_format?.json_schema?.name ?? 'unknown';
    calls.push(name);
    const reply =
      name === 'amble_game'
        ? compileReply
        : name === 'svg_art'
          ? { svg: coinSvg }
          : name === 'sound_recipe'
            ? { segments: [{ wave: 'square', startFreq: 800, endFreq: 1200, duration: 0.1, startVolume: 0.6, endVolume: 0 }] }
            : { parts: [] };
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' },
      body: sse(JSON.stringify(reply)),
    });
  });
}

async function gameFrame(page: Page) {
  const handle = await page.waitForSelector('iframe.player-frame');
  return (await handle.contentFrame())!;
}

test('compiles blocks with the AI and plays the game', async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('amble:settings', JSON.stringify({ apiKey: 'sk-test', model: 'gpt-5', assetModel: 'gpt-5-mini' }));
  });
  await mockOpenAI(page, calls);
  await page.goto('/');

  // The default project shows the starter scripts.
  await expect(page.locator('.blocklyMainBackground')).toBeVisible();
  await expect(page.locator('.sprite-tile', { hasText: 'Amble' })).toBeVisible();

  await page.getByRole('button', { name: /Compile/ }).click();

  // The compiled game starts by itself.
  const frame = await gameFrame(page);
  await expect.poll(async () => frame.evaluate(() => (window as unknown as { __test?: { time: number } }).__test?.time ?? 0), { timeout: 30_000 }).toBeGreaterThan(0.2);
  expect(calls).toEqual(['amble_game', 'svg_art']);

  // The compiler's sprite shows up as a compiled sprite.
  await expect(page.locator('.sprite-tile.compiled', { hasText: 'Coin' })).toBeVisible();
  await expect(page.locator('.how-to-play')).toContainText('Grab the coin');

  // Walk right into the coin.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => frame.evaluate(() => (window as unknown as { __test?: { score: number } }).__test?.score ?? 0), { timeout: 15_000 }).toBe(1);
  await page.keyboard.up('ArrowRight');

  // The wait() in a normal method was auto-fixed (the method became a generator).
  await page.getByRole('tab', { name: /Problems/ }).click();
  await expect(page.locator('.problem.warning').first()).toBeVisible();
  await expect(page.locator('.problems')).toContainText('Made onKeyDown() a generator');

  // The compiled art is listed under the Coin's costumes.
  await page.locator('.sprite-tile.compiled', { hasText: 'Coin' }).click();
  await page.getByRole('tab', { name: /Costumes/ }).click();
  await expect(page.locator('.asset-tile.compiled', { hasText: 'coin' })).toBeVisible();
  await expect(page.locator('.compiled-preview')).toContainText('a shiny gold coin with a star');

  // Keep the compiled sprite: it becomes one of the author's sprites.
  await page.getByRole('tab', { name: /Code/ }).first().click();
  await page.getByRole('button', { name: /Keep as my sprite/ }).click();
  await expect(page.locator('.sprite-tile:not(.compiled)', { hasText: 'Coin' })).toBeVisible();
});

test('3D world mode renders and runs', async ({ page }) => {
  await page.goto('/');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('radio', { name: '3D' }).click();
  await expect(page.locator('.mode-badge')).toHaveText('3D');
  const frame = await gameFrame(page);
  // The player reports loading and idle; start it with the green flag.
  await page.getByTitle('Start (green flag)').click();
  await expect
    .poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string; mode: string } }).__ambleGame?.mode ?? ''))
    .toBe('3d');
  await expect.poll(async () => frame.evaluate(() => (window as unknown as { __ambleGame?: { state: string } }).__ambleGame?.state ?? '')).toBe('running');
});
