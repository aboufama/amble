/**
 * The player core in a real browser, through its harness (dev/player/): the sandbox, the kit, stand-ins,
 * hot swaps, errors, the robot test, pause and taps, the flash limiter, touch controls, dials and twists,
 * restarts, the navigation guard and exported pages.
 *   npx playwright test -c dev/player/playwright.config.ts
 */
import { expect, test, type Frame, type Page } from '@playwright/test';

interface LogEntry {
  t: number;
  type: string;
  data: unknown;
}

interface RobotResult {
  pass: boolean;
  reasons: string[];
  frames: number;
  speed: number;
  hero: { found: boolean; moved: number };
}

interface KitApiLike {
  docs: Record<string, Array<{ name: string; sig: string }>>;
  namespaces: Record<string, string[]>;
}

interface Harness {
  player: {
    restart(): Promise<void>;
    restartLevel(): void;
    pause(): void;
    resume(): void;
    setDial(key: string, value: number): void;
    setTwist(id: string, on: boolean): void;
    setPrefs(p: Record<string, unknown>): void;
    clearArt(key: string): void;
    load(b: { files: Array<{ name: string; source: string }> }): Promise<void>;
    iframe: HTMLIFrameElement | null;
  };
  log: LogEntry[];
  load(name: string, extra?: Record<string, unknown>): Promise<void>;
  swap(key?: string, kind?: string): Promise<void>;
  robot(name: string, o?: Record<string, unknown>): Promise<RobotResult>;
  exportPage(name: string): Promise<string>;
  kitApi: KitApiLike;
}

type Win = Window & { harness: Harness };

/** What the runtime exposes for tests inside the game frame (window.__ambleGame). */
interface GameHook {
  state: string;
  createCount: number;
  swaps: number;
  errors: unknown[];
  game: unknown;
  scene: unknown;
  find(key: string): unknown;
  stats(): { objects: number; frames: number };
  dial(name: string): number | undefined;
  twists(): string[];
}

type GameWin = Window & { __ambleGame: GameHook };

async function open(page: Page): Promise<string[]> {
  const external: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith('http://127.0.0.1:5213/') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('about:')) external.push(url);
  });
  await page.goto('/dev/player/index.html');
  await page.waitForFunction(() => !!(window as unknown as Win).harness);
  return external;
}

async function load(page: Page, name: string, extra: Record<string, unknown> = { autostart: true }): Promise<Frame> {
  await page.evaluate(([n, e]) => (window as unknown as Win).harness.load(n as string, e as Record<string, unknown>), [name, extra] as const);
  return gameFrame(page);
}

async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as Win).harness.player.iframe);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('no game frame');
  await frame.waitForFunction(() => !!(window as unknown as GameWin).__ambleGame?.game);
  return frame;
}

function logOf(page: Page, type: string): Promise<LogEntry[]> {
  return page.evaluate((t) => (window as unknown as Win).harness.log.filter((l) => l.type === t), type);
}

test.describe('the player', () => {
  test('runs the test games with stand-ins for every picture, no errors and no network', async ({ page }) => {
    const external = await open(page);
    for (const name of ['boss', 'runner', 'chaos', 'plain', 'strobe']) {
      const frame = await load(page, name);
      await page.waitForTimeout(1200);
      const info = await frame.evaluate(() => {
        const g = (window as unknown as GameWin).__ambleGame;
        return { errors: g.errors.length, state: g.state };
      });
      expect(info.errors, name).toBe(0);
      expect(['running', 'title', 'paused'], name).toContain(info.state);
      const manifest = await page.evaluate(() => (window as unknown as Win).harness.log.filter((l) => l.type === 'manifest').at(-1)?.data as { art: string[] } | undefined);
      // The strobe test draws nothing; every other game needs pictures.
      if (name !== 'strobe') expect(manifest?.art.length, name).toBeGreaterThan(0);
      const missing = await frame.evaluate((keys) => {
        const game = (window as unknown as GameWin).__ambleGame.game as { textures: { exists(k: string): boolean; getTextureKeys(): string[] } };
        const all = game.textures.getTextureKeys();
        // A picture's stand-in: its own texture, the crisp one, a character's bone parts or ragdoll pieces.
        return keys.filter((k) => !game.textures.exists(k) && !game.textures.exists(k + '~hd') && !all.some((t) => t.startsWith(`~g:${k}:`) || t.startsWith(`~rag:${k}:`)));
      }, manifest?.art ?? []);
      // Keys only declared (not used yet) have no texture until used; the used ones all have stand-ins.
      const used = await page.evaluate(() => [...new Set((window as unknown as Win).harness.log.filter((l) => l.type === 'artMissing').map((l) => l.data as string))]);
      expect(missing.filter((k) => used.includes(k)), name).toEqual([]);
      expect(await logOf(page, 'error'), name).toEqual([]);
    }
    expect(external).toEqual([]);
  });

  test('stand-ins are marked as undrawn and characters wear their bones', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(800);
    const hero = await frame.evaluate(() => {
      const h = (window as unknown as GameWin).__ambleGame.find('hero') as { drawn: boolean; list: unknown[]; hp: number } | null;
      return h ? { drawn: h.drawn, parts: h.list.length, hp: h.hp } : null;
    });
    expect(hero).toMatchObject({ drawn: false, hp: 5 });
    const tags = await frame.evaluate(() => {
      const scene = (window as unknown as GameWin).__ambleGame.scene as { children: { list: Array<{ texture?: { key: string } }> } };
      return scene.children.list.map((o) => o.texture?.key ?? '').filter((k) => k.startsWith('~tag:'));
    });
    expect(tags).toEqual(expect.arrayContaining(['~tag:hero', '~tag:boss']));
  });

  test('hot-swaps a drawing into the running game without a restart, and back', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(800);
    const before = await frame.evaluate(() => (window as unknown as GameWin).__ambleGame.createCount);
    await page.evaluate(() => (window as unknown as Win).harness.swap('hero', 'hero'));
    await expect.poll(() => logOf(page, 'swapped').then((l) => l.length)).toBe(1);
    const swapped = (await logOf(page, 'swapped'))[0].data as { key: string; objects: number; ms: number };
    expect(swapped.key).toBe('hero');
    expect(swapped.objects).toBeGreaterThan(0);
    expect(swapped.ms).toBeLessThan(50);
    const after = await frame.evaluate(() => {
      const g = (window as unknown as GameWin).__ambleGame;
      const h = g.find('hero') as { drawn: boolean; hp: number };
      return { creates: g.createCount, drawn: h.drawn, hp: h.hp };
    });
    expect(after).toEqual({ creates: before, drawn: true, hp: 5 });
    await page.evaluate(() => (window as unknown as Win).harness.player.clearArt('hero'));
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('hero') as { drawn: boolean }).drawn)).toBe(false);
  });

  test("maps an error to the student's file and line, and keeps the picture", async ({ page }) => {
    await open(page);
    const frame = await load(page, 'broken');
    await expect.poll(() => logOf(page, 'error').then((l) => l.length), { timeout: 20_000 }).toBeGreaterThan(0);
    const error = (await logOf(page, 'error'))[0].data as { file: string; line: number; phase: string; fatal: boolean; message: string };
    expect(error).toMatchObject({ file: 'broken.js', line: 13, phase: 'update', fatal: true });
    expect(error.message).toMatch(/reading 'x'/);
    await expect(frame.locator('.amble-oops')).toContainText('line 13 of broken.js');
    await expect.poll(() => frame.evaluate(() => (window as unknown as GameWin).__ambleGame.state)).toBe('crashed');
  });

  test('the robot test plays on a manual clock and judges the result', async ({ page }) => {
    await open(page);
    const good = await page.evaluate(() => (window as unknown as Win).harness.robot('boss', { gameMs: 6000, seed: 2 }));
    expect(good.pass, good.reasons.join('\n')).toBe(true);
    expect(good.frames).toBe(360);
    expect(good.speed).toBeGreaterThan(0);
    expect(good.hero.moved).toBeGreaterThan(8);
    expect(Object.keys(good)).not.toContain('fps');
    const bad = await page.evaluate(() => (window as unknown as Win).harness.robot('broken', { gameMs: 3000 }));
    expect(bad.pass).toBe(false);
    expect(bad.reasons[0]).toContain('line 13 of broken.js');
  });

  test('pausing freezes the game, shows every tag, and tapping a stand-in names it', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(1000);
    await page.evaluate(() => (window as unknown as Win).harness.player.pause());
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.game as { loop: { running: boolean } }).loop.running)).toBe(false);
    // A point on the boss that no other thing covers (its orbs fly out of its middle from the start).
    const where = await frame.evaluate(() => {
      type Box = { key: string | null; x: number; y: number; w: number; h: number };
      const objects = ((window as unknown as GameWin).__ambleGame as unknown as { objects(): Box[] }).objects();
      const boss = objects.find((o) => o.key === 'boss');
      if (!boss) throw new Error('no boss on screen');
      const others = objects.filter((o) => o !== boss);
      for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          const x = boss.x + boss.w * fx;
          const y = boss.y + boss.h * fy;
          if (!others.some((o) => x >= o.x - 4 && x <= o.x + o.w + 4 && y >= o.y - 4 && y <= o.y + o.h + 4)) return { x, y };
        }
      }
      return { x: boss.x + boss.w / 2, y: boss.y + boss.h / 2 };
    });
    const box = await page.locator('#stage iframe:visible').first().boundingBox();
    if (!box) throw new Error('no iframe box');
    await page.mouse.click(box.x + where.x, box.y + where.y);
    await expect.poll(() => logOf(page, 'artClicked').then((l) => (l[0]?.data as { key: string } | undefined)?.key)).toBe('boss');
    await page.evaluate(() => (window as unknown as Win).harness.player.resume());
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.game as { loop: { running: boolean } }).loop.running)).toBe(true);
  });

  test('the flash limiter keeps a strobing game to at most 3 flashes a second', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'strobe');
    await page.waitForTimeout(600);
    const run = await frame.evaluate(async () => {
      const hook = (window as unknown as GameWin).__ambleGame as GameHook & { flashes(): number[] };
      const game = hook.game as {
        renderer: { gl?: WebGLRenderingContext };
        events: { on(e: string, f: () => void): void; off(e: string, f: () => void): void };
      };
      const scene = hook.scene as { cameras: { main: { flashEffect: { start(...a: unknown[]): unknown } } } };
      // Count what the game asks for (the limiter sits inside the real start).
      const flash = scene.cameras.main.flashEffect;
      let asked = 0;
      if (flash) {
        const real = flash.start.bind(flash);
        flash.start = (...a: unknown[]) => {
          asked++;
          return real(...a);
        };
      }
      const gl = game.renderer.gl;
      const px = new Uint8Array(4);
      const samples: Array<[number, number]> = [];
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const read = () => {
        if (!gl) return;
        gl.readPixels(60, 60, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        samples.push([performance.now(), 0.2126 * lin(px[0]) + 0.7152 * lin(px[1]) + 0.0722 * lin(px[2])]);
      };
      const t0 = performance.now();
      game.events.on('postrender', read);
      await new Promise((r) => setTimeout(r, 3500));
      game.events.off('postrender', read);
      return { asked, samples, allowed: hook.flashes().filter((t) => t >= t0) };
    });
    // The game asked for far more than it got.
    expect(run.asked).toBeGreaterThan(10);
    const perSecond = (times: number[]) => Math.max(0, ...times.map((t) => times.filter((u) => u >= t && u < t + 1000).length));
    expect(run.allowed.length).toBeGreaterThan(0);
    expect(perSecond(run.allowed)).toBeLessThanOrEqual(3);
    // And on screen, WCAG 2.3.1: a flash is a rise in relative luminance of 10% or more.
    const rises: number[] = [];
    for (let i = 1; i < run.samples.length; i++) if (run.samples[i][1] - run.samples[i - 1][1] >= 0.1) rises.push(run.samples[i][0]);
    expect(perSecond(rises)).toBeLessThanOrEqual(3);
  });

  test('touch controls appear with touch on and drive the hero', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss', { autostart: true, prefs: { touch: 'on' } });
    await expect(frame.locator('.amble-touch.on')).toBeVisible();
    await expect.poll(() => frame.locator('.t-btn').count()).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(800);
    const y0 = await frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('hero') as { y: number }).y);
    const jump = frame.locator('.t-btn', { hasText: 'JUMP' });
    await jump.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('hero') as { y: number }).y), { timeout: 5000 }).toBeLessThan(y0 - 10);
    await jump.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true });
    await expect(frame.locator('.t-btn', { hasText: 'BLAST' })).toHaveCount(1);
  });

  test('dials change the running game live, or restart the level when they must', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(800);
    const c0 = await frame.evaluate(() => (window as unknown as GameWin).__ambleGame.createCount);
    await page.evaluate(() => (window as unknown as Win).harness.player.setDial('jump', 1000));
    await expect.poll(() => frame.evaluate(() => (window as unknown as GameWin).__ambleGame.dial('jump'))).toBe(1000);
    await page.waitForTimeout(400);
    expect(await frame.evaluate(() => (window as unknown as GameWin).__ambleGame.createCount)).toBe(c0);
    await page.evaluate(() => (window as unknown as Win).harness.player.setDial('bossHealth', 300));
    await expect.poll(() => frame.evaluate(() => (window as unknown as GameWin).__ambleGame.createCount)).toBe(c0 + 1);
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('boss') as { maxHp: number } | null)?.maxHp)).toBe(300);
    // The jump dial survived the restart.
    expect(await frame.evaluate(() => (window as unknown as GameWin).__ambleGame.dial('jump'))).toBe(1000);
  });

  test('twists switch on and off live', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(800);
    const gravity = () => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.scene as { physics: { world: { gravity: { y: number } } } }).physics.world.gravity.y);
    expect(await gravity()).toBe(1500);
    await page.evaluate(() => (window as unknown as Win).harness.player.setTwist('moonGravity', true));
    await expect.poll(gravity).toBeCloseTo(675);
    await page.evaluate(() => (window as unknown as Win).harness.player.setTwist('giantHero', true));
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('hero') as { scaleX: number }).scaleX)).toBeCloseTo(1.8);
    await page.evaluate(() => (window as unknown as Win).harness.player.setTwist('moonGravity', false));
    await page.evaluate(() => (window as unknown as Win).harness.player.setTwist('giantHero', false));
    await expect.poll(gravity).toBeCloseTo(1500);
    await expect.poll(() => frame.evaluate(() => ((window as unknown as GameWin).__ambleGame.find('hero') as { scaleX: number }).scaleX)).toBeCloseTo(1);
    const manifest = await page.evaluate(() => (window as unknown as Win).harness.log.filter((l) => l.type === 'manifest').length);
    expect(manifest).toBeGreaterThan(0);
    expect(await logOf(page, 'error')).toEqual([]);
  });

  test('restarts do not leak WebGL contexts or objects', async ({ page }) => {
    test.setTimeout(300_000);
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (/WebGL|context/i.test(m.text())) warnings.push(m.text());
    });
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(600);
    for (let i = 0; i < 20; i++) await page.evaluate(() => (window as unknown as Win).harness.player.restartLevel());
    await expect.poll(() => frame.evaluate(() => (window as unknown as GameWin).__ambleGame.createCount)).toBeGreaterThanOrEqual(21);
    await page.waitForTimeout(600);
    const objects = await frame.evaluate(() => (window as unknown as GameWin).__ambleGame.stats().objects);
    expect(objects).toBeLessThan(250);
    for (let i = 0; i < 20; i++) await page.evaluate(() => (window as unknown as Win).harness.player.restart());
    const last = await gameFrame(page);
    const renderer = await last.evaluate(() => ((window as unknown as GameWin).__ambleGame.game as { renderer: { type: number } }).renderer.type);
    expect(renderer).toBe(2);
    expect(await page.locator('#stage iframe').count()).toBeLessThanOrEqual(3);
    expect(warnings.filter((w) => /too many|lost/i.test(w))).toEqual([]);
    expect(await logOf(page, 'error')).toEqual([]);
  });

  test('a game that tries to leave its frame is rebuilt once, then stopped', async ({ page }) => {
    const external = await open(page);
    const source = "class Game extends Amble.Scene { create() { this.after(200, () => { location.href = 'https://example.com/'; }); } }";
    await page.evaluate((src) => void (window as unknown as Win).harness.player.load({ files: [{ name: 'game.js', source: src }] }).catch(() => undefined), source);
    await expect.poll(() => logOf(page, 'navigated').then((l) => l.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => logOf(page, 'error').then((l) => l.map((e) => (e.data as { message: string }).message).join()), { timeout: 10_000 }).toMatch(/keeps trying to open a web page/);
    expect(external.filter((u) => u.includes('example.com'))).toEqual([]);
  });

  test('an exported page plays by itself with no network', async ({ page, context }) => {
    await open(page);
    const html = await page.evaluate(() => (window as unknown as Win).harness.exportPage('boss'));
    const exported = await context.newPage();
    const requests: string[] = [];
    exported.on('request', (r) => {
      if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url());
    });
    await exported.setContent(html);
    await exported.getByRole('button', { name: /Play/ }).click();
    await exported.waitForFunction(() => ['title', 'running'].includes((window as unknown as GameWin).__ambleGame?.state), undefined, { timeout: 30_000 });
    const errors = await exported.evaluate(() => (window as unknown as GameWin).__ambleGame.errors.length);
    expect(errors).toBe(0);
    expect(requests).toEqual([]);
  });

  test('everything KIT_API lists exists in a running game', async ({ page }) => {
    await open(page);
    const frame = await load(page, 'boss');
    await page.waitForTimeout(600);
    const api = await page.evaluate(() => (window as unknown as Win).harness.kitApi);
    const missing = await frame.evaluate((kit) => {
      const g = (window as unknown as GameWin).__ambleGame;
      const scene = g.scene as Record<string, unknown>;
      const hero = g.find('hero') as Record<string, unknown>;
      const out: string[] = [];
      for (const m of kit.docs.scene) if (!(m.name in scene)) out.push(`this.${m.name}`);
      for (const [ns, names] of Object.entries(kit.namespaces)) {
        const obj = scene[ns] as Record<string, unknown>;
        for (const n of names) if (!(n in obj)) out.push(`this.${ns}.${n}`);
      }
      for (const m of kit.docs.actor) if (m.sig.includes('(') && !(m.name in hero)) out.push(`hero.${m.name}`);
      const amble = (window as unknown as { Amble: Record<string, unknown> }).Amble;
      if (!Object.isFrozen(amble)) out.push('Amble is not frozen');
      return out;
    }, api);
    expect(missing).toEqual([]);
  });
});
