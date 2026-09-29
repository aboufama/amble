// Plays the starter worlds in Playwright's Chromium (headless) through the harness page:
//   --robot   robot-tests every starter, every seed and a seed with another kind of hero (6 s, 0 errors)
//   --signs   writes public/starters/<id>/sign.png (320x180) from a played frame
//   --shots   screenshots each starter while a scripted player plays it   -> $OUT/<id>-<n>.png
//   --rigs    every move of every drawn character (with and without bones)  -> $OUT/rigs/<id>-<key>.png
// OUT defaults to the scratchpad's out-starters folder (set STARTERS_OUT to change it).
//   node tools/starters/review.mjs --robot --shots [starter ids...]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const only = args.filter((a) => !a.startsWith('--'));
const OUT = process.env.STARTERS_OUT ?? '/tmp/claude-0/-home-user-amble/847fd994-c08b-555b-932e-3a1946f04e60/scratchpad/rebuild/out-starters';
mkdirSync(join(OUT, 'rigs'), { recursive: true });
const port = Number(process.env.STARTERS_PORT) || 5288;

// What a scripted player does in each starter ([at, for, key] holds and [at, x, y] clicks), and when the
// screenshots are taken (game ms after start).
// `sign` is when the Trail's sign (public/starters/<id>/sign.png) is taken.
const SCRIPTS = {
  'moon-king': { hold: [[0, 900, 'ArrowRight'], [300, 500, 'Space'], [900, 1200, 'KeyX'], [2200, 1600, 'KeyX'], [2400, 300, 'ArrowUp']], shots: [700, 2600, 4200], sign: 3000 },
  'sky-run': { hold: [[600, 150, 'Space'], [1500, 150, 'Space'], [1700, 150, 'Space'], [2600, 150, 'Space']], shots: [800, 2000, 3400], sign: 2000 },
  'wobble-tower': { hold: [[500, 100, 'Space'], [1600, 100, 'Space'], [2000, 100, 'KeyR'], [2700, 100, 'Space']], click: [[3300, 480, 300]], shots: [1400, 3000, 3700], sign: 2900 },
  'lantern-maze': { hold: [[0, 450, 'ArrowRight'], [450, 700, 'ArrowUp'], [1300, 500, 'ArrowDown'], [1800, 900, 'ArrowRight']], shots: [600, 1500, 3200], sign: 1500 },
  'clanks-climb': { hold: [[0, 700, 'ArrowRight'], [200, 300, 'Space'], [900, 600, 'ArrowLeft'], [1100, 300, 'Space'], [1500, 250, 'Space']], shots: [600, 1650, 3200], sign: 1650 },
  parade: { hold: [], shots: [1500, 3500] },
};

const server = await createServer({ configFile: join(here, 'vite.config.mjs'), root, server: { port }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/tools/starters/harness/index.html`);
await page.waitForFunction(() => !!window.starters);
const ids = (await page.evaluate(() => window.starters.ids)).filter((id) => !only.length || only.includes(id));
let failed = 0;

/** The visible game's frame (never the player's warm spare). */
async function gameFrame() {
  const el = (await page.evaluateHandle(() => window.starters.player.iframe)).asElement();
  return el ? el.contentFrame() : null;
}

/** The game's own clock (ms of game time since the level started): scripts follow it, not the wall clock. */
async function gameClock() {
  const frame = await gameFrame();
  return frame ? frame.evaluate(() => window.__ambleGame?.scene?.clock ?? 0).catch(() => 0) : 0;
}

async function untilGame(ms) {
  for (let i = 0; i < 2000 && (await gameClock()) < ms; i++) await page.waitForTimeout(20);
}

async function stageShot() {
  return page.locator('#stage').screenshot({ type: 'png' });
}

async function play(id, o, fn) {
  const ms = await page.evaluate(([i, opts]) => window.starters.load(i, opts), [id, o]);
  await page.locator('#stage iframe').click({ position: { x: 900, y: 20 } }).catch(() => undefined);
  await fn(ms);
}

/** Plays a starter's script; `shots` are [game ms, save(png)] pairs. Stops (keys up) after the last shot. */
async function scripted(id, withArt, shots) {
  const s = SCRIPTS[id] ?? { hold: [], shots: [1500] };
  await play(id, { withArt, autostart: true }, async () => {
    const events = [];
    const down = new Set();
    for (const [at, dur, key] of s.hold) {
      events.push({ at, run: () => (down.add(key), page.keyboard.down(key)) });
      events.push({ at: at + dur, run: () => (down.delete(key), page.keyboard.up(key)) });
    }
    for (const [at, x, y] of s.click ?? []) events.push({ at, run: () => page.locator('#stage').click({ position: { x, y } }) });
    for (const [at, save] of shots(s)) events.push({ at, run: async () => save(await stageShot()) });
    const end = Math.max(...shots(s).map(([at]) => at));
    events.sort((a, b) => a.at - b.at);
    for (const e of events.filter((ev) => ev.at <= end)) {
      await untilGame(e.at);
      await e.run();
    }
    for (const key of down) await page.keyboard.up(key);
  });
}

/** Hides the controls hint line (it is unreadable at sign size). */
async function hideHint() {
  const frame = await gameFrame();
  await frame?.evaluate(() => {
    const ui = window.__ambleGame.scene.scene.get('__amble_ui');
    for (const o of ui.children.list) if (o.type === 'Text' && o.y > ui.scale.height - 60 && String(o.text).includes('·')) o.setVisible(false);
  });
}

for (const id of ids) {
  if (has('--robot')) {
    const runs = id === 'parade' ? [['as a seed', { withArt: false }]] : [['with art', { withArt: true }], ['as a seed', { withArt: false }], ['as a seed with Biscuit', { withArt: false, heroFrom: id === 'lantern-maze' ? 'wobble-tower' : 'lantern-maze' }]];
    for (const [label, o] of runs) {
      const r = await page.evaluate(([i, opts]) => window.starters.robot(i, opts).then((x) => ({ pass: x.pass, reasons: x.reasons, notes: x.notes, frames: x.frames, speed: x.speed, peak: x.peakObjects, bodies: x.peakMatterBodies, hero: x.hero })), [id, o]);
      if (!r.pass) failed++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${id} ${label}: ${r.frames} frames, speed ${r.speed?.toFixed?.(1)}, peak ${r.peak} objects, ${r.bodies} bodies${r.reasons.length ? `\n   ${r.reasons.join('\n   ')}` : ''}${r.notes.length ? `\n   note: ${r.notes.join(' | ')}` : ''}`);
    }
  }
  if (has('--shots')) {
    for (const [withArt, tag] of id === 'parade' ? [[true, '']] : [[true, ''], [false, '-seed']]) {
      await scripted(id, withArt, (s) => s.shots.map((at, n) => [at, (png) => writeFileSync(join(OUT, `${id}${tag}-${n + 1}.png`), png)]));
    }
    console.log(`shots: ${id}`);
  }
  if (has('--signs') && id !== 'parade') {
    const file = join(root, 'public/starters', id, 'sign.png');
    const sign = async () => {
      await hideHint();
      const png = await stageShot();
      const small = await page.evaluate((b64) => window.starters.shrink(`data:image/png;base64,${b64}`, 320, 180), png.toString('base64'));
      writeFileSync(file, Buffer.from(small.split(',')[1], 'base64'));
      writeFileSync(join(OUT, `${id}-sign-full.png`), png);
    };
    await scripted(id, true, (s) => [[s.sign ?? 2600, sign]]);
    console.log(`sign: ${file}`);
  }
  if (has('--title')) {
    await play(id, { withArt: true, autostart: false }, async () => {
      await page.waitForTimeout(1500);
      writeFileSync(join(OUT, `${id}-title.png`), await stageShot());
    });
    for (const [end, call] of [['win', 'win'], ['lose', 'lose']]) {
      await play(id, { withArt: true, autostart: true }, async () => {
        await page.waitForTimeout(1200);
        const frame = await gameFrame();
        await frame?.evaluate((c) => window.__ambleGame.scene[c](), call);
        await page.waitForTimeout(1800);
        writeFileSync(join(OUT, `${id}-${end}.png`), await stageShot());
      });
    }
    console.log(`title, win and lose: ${id}`);
  }
  if (has('--rigs')) {
    const keys = await page.evaluate((i) => window.starters.catalog.open(i, { withArt: true }).then((o) => o.art.filter((a) => a.rigData).map((a) => Object.values(o.world.cast).find((c) => c.art === a.id)?.key)), id);
    for (const key of keys) {
      for (const bones of [false, true]) {
        const url = await page.evaluate(([i, k, b]) => window.starters.rigSheet(i, k, { bones: b }), [id, key, bones]);
        writeFileSync(join(OUT, 'rigs', `${id}-${key}${bones ? '-bones' : ''}.png`), Buffer.from(url.split(',')[1], 'base64'));
      }
      console.log(`rigs: ${id}/${key}`);
    }
  }
}

await browser.close();
await server.close();
if (failed) {
  console.error(`${failed} robot test(s) failed.`);
  process.exit(1);
}
