// Performance: input-to-pixels latency, engine work per frame, pen-up commit, fills (cold and warm), undo and
// redo, long tasks and frame gaps, per brush and zoomed in, at 1x or 4x CPU throttle; a 120-stroke stress
// run for undo memory and heap; ArtScript replay speed (the starter worlds' drawings).
// Env: THROTTLE (default 4), DPR (default 1), STRESS=1, ART_GPU=none (CPU raster instead of SwiftShader).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { ROOT, launch, humanStroke, sendStroke, ellipse, line, through, mulberry32, saveJson, settle, sleep } from './lib.mjs';

/**
 * The starter worlds' ArtScripts, as the starters build replays them (src/starters/<id>/art/<key>.art.ts):
 * the first drawing of each starter. Each file is TypeScript with a type-only import, so esbuild's transform
 * is enough to load it.
 */
async function starterScripts() {
  const base = join(ROOT, 'src/starters');
  const files = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const first = readdirSync(join(base, d.name, 'art')).filter((f) => f.endsWith('.art.ts')).sort()[0];
        return first ? [`${d.name}/art/${first}`] : [];
      } catch {
        return [];
      }
    })
    .sort();
  const scripts = [];
  for (const file of files) {
    const { code } = await transform(readFileSync(join(base, file), 'utf8'), { loader: 'ts', format: 'esm' });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
    scripts.push({ file, script: mod.default });
  }
  return scripts;
}

const throttle = Number(process.env.THROTTLE ?? 4);
const dpr = Number(process.env.DPR ?? 1);
const tag = `${process.env.ART_GPU === 'none' ? 'cpu' : 'swiftshader'}-${throttle}x-dpr${dpr}`;
const { browser, page, cdp } = await launch({ throttle, dpr });
const S = (f, ...a) => page.evaluate(([f, a]) => window.__art.surface[f](...a), [f, a]);
const A = (f, ...a) => page.evaluate(([f, a]) => window.__art[f](...a), [f, a]);
const out = { tag, throttle, dpr, phases: {} };
let seed = 300;

await page.evaluate(() => {
  const w = window;
  w.__long = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__long.push(Math.round(e.duration));
  }).observe({ type: 'longtask', buffered: true });
  w.__gaps = [];
  let last = performance.now();
  const tick = (t) => {
    w.__gaps.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const drain = () =>
  page.evaluate(() => {
    const g = window.__gaps.sort((a, b) => a - b);
    const l = window.__long.slice();
    window.__gaps = [];
    window.__long = [];
    return { frameP95: Math.round(g[Math.floor(g.length * 0.95)] ?? 0), frameMax: Math.round(g[g.length - 1] ?? 0), longTasks: l.length, longestTask: Math.max(0, ...l) };
  });

async function phase(name, fn) {
  await settle(page);
  await A('resetStats');
  await drain();
  await fn();
  await settle(page);
  const st = await S('stats');
  const parts = Object.fromEntries(Object.entries(st.parts).map(([k, v]) => [k, `${v.p50}/${v.p95}`]));
  out.phases[name] = { latency: st.latency, work: st.work, parts, commit: st.commit, ...(await drain()), ...(st.fills.length ? { fills: st.fills.map((f) => ({ ms: Math.round(f.ms), analyzeMs: Math.round(f.analyzeMs), gap: f.gap, background: f.background })) } : {}) };
  console.log(name, JSON.stringify(out.phases[name]));
}

const wave = (y, amp) => through([[140, y], [300, y - amp], [460, y + amp], [620, y - amp], [780, y + amp], [900, y]]);

try {
  const info = await S('stats');
  out.env = { desynchronized: info.desynchronized, rawUpdates: info.rawUpdates, worker: info.worker };
  await sendStroke(page, cdp, humanStroke(line(100, 100, 300, 120), { seed: seed++ }));

  const brushes = [
    ['ink', 8],
    ['pencil', 6],
    ['marker', 30],
    ['crayon', 24],
    ['airbrush', 80],
    ['ink', 60],
    ['eraser', 40],
  ];
  let y = 170;
  for (const [tool, size] of brushes) {
    await S('setTool', tool);
    await S('setBrush', { size });
    await phase(`${tool}-${size}`, async () => {
      for (let i = 0; i < 3; i++) await sendStroke(page, cdp, humanStroke(wave(y + i * 30, 40), { seed: seed++, speed: 900 }));
    });
    y += 110;
    if (y > 900) y = 170;
  }

  // Zoomed in 4x (more device pixels per stamp).
  await S('setTool', 'ink');
  await S('setBrush', { size: 8 });
  await A('look', 4, 0, 512, 512);
  await phase('ink-8-zoom4', async () => {
    for (let i = 0; i < 3; i++) await sendStroke(page, cdp, humanStroke(through([[440, 470 + i * 20], [480, 500 + i * 20], [520, 480 + i * 20], [580, 520 + i * 20]]), { seed: seed++, speed: 250 }));
  });
  await S('fit');

  // Fills: closed shapes, then the background.
  await S('setTool', 'ink');
  await S('setBrush', { size: 8 });
  await S('clearLayer');
  for (let i = 0; i < 4; i++) await sendStroke(page, cdp, humanStroke(ellipse(200 + i * 210, 780, 85, 80, -90, 356), { seed: seed++, speed: 900 }));
  await phase('fills', async () => {
    for (let i = 0; i < 4; i++) {
      await S('setColor', ['#e8443a', '#f5a142', '#ffd23f', '#7cc95a'][i]);
      await S('fillAt', 200 + i * 210, 780);
    }
    await S('setColor', '#3aa7e8');
    await S('fillAt', 60, 60);
  });

  // Undo and redo times.
  out.undoRedo = await page.evaluate(async () => {
    const s = window.__art.surface;
    const t = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await s.undo();
      t.push(performance.now() - t0);
    }
    const r = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await s.redo();
      r.push(performance.now() - t0);
    }
    const f = (a) => ({ p50: +a.sort((x, y) => x - y)[3].toFixed(2), max: +Math.max(...a).toFixed(2) });
    return { undo: f(t), redo: f(r) };
  });
  console.log('undo/redo', JSON.stringify(out.undoRedo));

  if (process.env.STRESS === '1') {
    await S('setColor', '#2b1d16');
    const rnd = mulberry32(7);
    const t0 = Date.now();
    await phase('stress-120', async () => {
      for (let i = 0; i < 120; i++) {
        const tools = ['ink', 'pencil', 'marker', 'crayon'];
        await S('setTool', tools[i % 4]);
        await S('setBrush', { size: 4 + Math.round(rnd() * 30) });
        const x = 80 + rnd() * 860;
        const yy = 80 + rnd() * 860;
        await sendStroke(page, cdp, humanStroke(line(x, yy, x + (rnd() - 0.5) * 300, yy + (rnd() - 0.5) * 300, (rnd() - 0.5) * 60), { seed: seed++, speed: 1600, minDur: 90 }));
      }
    });
    const st = await S('stats');
    const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    out.stress = { seconds: Math.round((Date.now() - t0) / 1000), history: st.history, pixels: st.pixels, heap: await heap() };
    await sleep(4000);
    out.stress.historyIdle = (await S('stats')).history;
    out.stress.heapIdle = await heap();
    console.log('stress', JSON.stringify(out.stress));
  }

  // ArtScript replay speed (the starter worlds' drawings).
  out.replay = [];
  for (const { file, script } of await starterScripts()) {
    const r = await A('replayScript', script);
    out.replay.push({ script: file, ops: script.ops?.length ?? 0, ms: Math.round(r.ms) });
  }
  console.log('replay', JSON.stringify(out.replay));
  saveJson(out, `perf-${tag}.json`);
} finally {
  await browser.close();
}
