#!/usr/bin/env node
/**
 * Builds the demos once, for real, and ships them built: each example marked `prebuilt` in
 * src/project/examples.ts is compiled by the model (code, the compiler's characters, art and
 * sounds), played by a bot for a couple of minutes of game time to catch problems, and saved with its
 * compiled game to public/demos/<id>.amble, with a picture of it for the start screen
 * (public/demos/<id>.jpg). The start screen and File > Examples then open it ready to play.
 *
 * Needs the dev server running with a key (it uses the editor itself, in a headless browser):
 *
 *   OPENAI_API_KEY=sk-... npx vite --port 5173
 *   node scripts/precompile-demos.mjs --url http://localhost:5173 [--model gpt-6.1-terra] [--effort high] [--only disco-rex,sky-whale] [--play 150] [--jobs 2]
 *
 * A demo whose build fails, or whose game reports errors while it plays, isn't written (use
 * --force to write it anyway). --shots <dir> keeps pictures of the play for a look.
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = opt('url', 'http://localhost:5173');
const model = opt('model', 'gpt-6.1-terra');
const effort = opt('effort', 'high');
const only = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const shots = opt('shots', '');
const force = args.includes('--force');
const playSeconds = Number(opt('play', '150'));
// --mortal: the bot can lose (by default its lives are topped up, so the late game gets played).
const immortal = !args.includes('--mortal');
const jobs = Math.max(1, Number(opt('jobs', '2')));

// Benchmarking (scripts/bench-models.mjs runs this once per model): --out <dir> writes builds and
// pictures there instead of public/demos; --report <file.json> writes what happened to each build;
// --ideas <file.json> builds games from ideas ([{ id, idea, dial?, style? }]) instead of the demos.
const outDir = path.resolve(opt('out', path.join(root, 'public', 'demos')));
const report = opt('report', '');
const ideasFile = opt('ideas', '');
const ideas = ideasFile ? JSON.parse(readFileSync(ideasFile, 'utf8')) : null;
const results = [];
mkdirSync(outDir, { recursive: true });
// One run per --out folder: a second run for the same folder (another benchmark runner) stops here.
if (opt('out', '')) {
  const lock = path.join(outDir, '.lock');
  try {
    writeFileSync(lock, String(process.pid), { flag: 'wx' });
  } catch {
    console.log(`Already running or done in ${outDir}; skipped.`);
    process.exit(0);
  }
}
if (shots) mkdirSync(shots, { recursive: true });

const config = await (await fetch(new URL('api/config', url))).json().catch(() => ({}));
if (!config.serverKey) {
  console.error(`The dev server at ${url} has no OPENAI_API_KEY. Start it with one (see the top of this file).`);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// The editor, not Home (where a first visit starts).
// (Only in the editor's own page: the player's sandboxed frame may not touch storage.)
const inEditor = () => {
  if (window === window.top) localStorage.setItem('amble:start', 'seen');
};
const first = await browser.newPage({ ignoreHTTPSErrors: true });
await first.addInitScript(inEditor);
await first.goto(url, { timeout: 240_000 });
await first.waitForSelector('.blocklyMainBackground', { timeout: 300_000 });
const ids = ideas
  ? ideas.map((i) => i.id)
  : await first.evaluate(async () => {
      const { EXAMPLES } = await import('/src/project/examples.ts');
      return EXAMPLES.filter((e) => e.prebuilt).map((e) => e.id);
    });
await first.close();

/** Builds one demo in a page of its own, plays it and writes it. Returns what happened, as lines to print. */
async function build(id) {
  const lines = [];
  const say = (line) => lines.push(`   ${line}`);
  // A browser context of its own: its own spend counter and saved project.
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, ignoreHTTPSErrors: true });
  await context.addInitScript(inEditor);
  // --harness '<json>': how the compile is carried out (src/compiler/harness.ts); every request is traced.
  await context.addInitScript((h) => {
    if (h) window.__ambleHarness = JSON.parse(h);
    // Asking the player (harness "ask"): a quick player picks the first choice of each question.
    if (h && JSON.parse(h).ask) window.__ambleAutoAnswer = 2500;
    window.__ambleTrace = [];
    window.__ambleTraceText = true;
  }, opt('harness', ''));
  const p = await context.newPage();
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.goto(url, { timeout: 240_000 });
  await p.waitForSelector('.blocklyMainBackground', { timeout: 300_000 });
  const built = await p.evaluate(
    async ({ id, model, effort, idea, assetModel }) => {
      const store = window.__ambleStore;
      const actions = await import('/src/actions.ts');
      store.getState().closeHome();
      store.getState().setSettings({ apiKey: '', useChatGpt: false, model, reasoningEffort: effort, assetModel: assetModel || model, artMode: 'svg' });
      if (idea) {
        const { ideaProject } = await import('/src/project/idea.ts');
        store.getState().setProject(ideaProject(idea.idea, idea.dial ?? 3, idea.style ?? ''));
      } else {
        const { EXAMPLES } = await import('/src/project/examples.ts');
        store.getState().setProject(EXAMPLES.find((e) => e.id === id).make());
      }
      await new Promise((r) => setTimeout(r, 1200));
      const t = performance.now();
      await actions.compile(undefined, { fresh: true });
      const s = store.getState();
      const c = s.project.compiled;
      return {
        seconds: (performance.now() - t) / 1000,
        status: s.compile.status,
        error: s.compile.error,
        warnings: c?.warnings ?? [],
        questions: (c?.questions ?? []).map((q) => q.text),
        picks: window.__amblePicks ?? null,
        pieces: c?.pieces?.length ?? 0,
        cast: (c?.sprites ?? []).map((x) => x.name),
        assets: c?.assets?.length ?? 0,
        how: c?.howToPlay ?? '',
        trace: (window.__ambleTrace ?? []).map((e) => ({ ...e, t0: Math.round(e.t0 - t), ms: Math.round(e.ms ?? 0), first: e.first === undefined ? null : Math.round(e.first) })),
      };
    },
    { id, model, effort, idea: ideas?.find((i) => i.id === id) ?? null, assetModel: opt('asset-model', '') },
  );
  say(`built in ${built.seconds.toFixed(0)} s with ${model} (${effort}): ${built.status}${built.error ? ` (${built.error})` : ''}`);
  say(`${built.pieces} pieces; cast: ${built.cast.join(', ') || 'none'}; art and sounds: ${built.assets}${built.how ? `; how to play: ${built.how}` : ''}`);
  for (const w of built.warnings) say(`warning: ${w}`);
  for (const q of built.questions) say(`question: ${q}`);
  const spendNow = () =>
    p.evaluate(() => {
      try {
        return Object.values(JSON.parse(localStorage.getItem('amble:spend')).byModel).reduce((n, m) => n + m.usd, 0);
      } catch {
        return 0;
      }
    });
  const record = { id, model, effort, harness: opt('harness', '') ? JSON.parse(opt('harness', '')) : null, trace: built.trace, buildSeconds: built.seconds, status: built.status, error: built.error ?? null, pieces: built.pieces, cast: built.cast, assets: built.assets, how: built.how, warnings: built.warnings, questions: built.questions, picks: built.picks };
  results.push(record);
  if (built.status !== 'done') {
    record.usd = await spendNow().catch(() => 0);
    await context.close();
    return { id, ok: false, usd: record.usd, lines: [...lines, '   NOT written (the build failed).'] };
  }

  // Benchmarks keep every paid build, even if the play below fails: save it now (the play overwrites it).
  if (opt('out', '')) {
    const early = await p.evaluate(() => window.__ambleStore.getState().project);
    writeFileSync(path.join(outDir, `${id}.amble`), JSON.stringify(early));
  }
  const frameBox = async () => (await (await p.waitForSelector('iframe.player-frame', { timeout: 300_000 })).boundingBox());
  // The bot plays badly, and the last acts (the boss, the ending) must run too: so it can't run out of
  // lives. Whatever the game counts as lives, hearts, health... is topped up to the most it has had.
  const snap = async () => {
    const f = await (await p.waitForSelector('iframe.player-frame', { timeout: 300_000 })).contentFrame();
    return f
      .evaluate((immortal) => {
        const g = window.__ambleGame;
        if (!g) return null;
        if (immortal) {
          const most = (window.__most ??= {});
          for (const [k, v] of Object.entries(g.vars ?? {})) {
            if (typeof v !== 'number' || !/live|life|heart|health|hp|chance|tries|energy/i.test(k)) continue;
            most[k] = Math.max(most[k] ?? v, v);
            if (v < most[k]) g.vars[k] = most[k];
          }
        }
        return { state: g.state, time: g.time };
      }, immortal)
      .catch(() => null);
  };
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  let box = await frameBox();
  let total = 0;
  let last = 0;
  let held = null;
  let restarts = 0;
  let pictured = false;
  const ends = [];
  const wall0 = Date.now();
  // Play by game time: steer, jump, click around, and start again when the game ends.
  while (total < playSeconds && Date.now() - wall0 < 600_000) {
    const s = await snap();
    if (!s) {
      await p.waitForTimeout(300);
      continue;
    }
    if (s.time < last) last = 0;
    total += s.time - last;
    last = s.time;
    if (!pictured && total >= 12) {
      // The picture for the start screen, at the normal stage size; the rest plays on the small stage (quicker without a GPU).
      pictured = true;
      await p.screenshot({ path: path.join(outDir, `${id}.jpg`), type: 'jpeg', quality: 72, clip: { x: box.x + 1, y: box.y + 1, width: 480, height: 360 }, timeout: 90_000 }).catch((e) => say(`no picture: ${e.message}`));
      await p.getByTitle('Small stage').click();
      await p.waitForTimeout(400);
      box = await frameBox();
    }
    if (s.state !== 'running') {
      ends.push(`${s.state} at ${s.time.toFixed(0)} s`);
      if (++restarts > 6) break;
      await p.locator('.green-flag').click();
      await p.waitForTimeout(1500);
      last = 0;
      continue;
    }
    const r = Math.random();
    if (r < 0.45) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (held && held !== k) await p.keyboard.up(held);
      if (held !== k) await p.keyboard.down(k);
      held = k;
    } else if (r < 0.7) await p.keyboard.press('Space');
    else {
      const x = box.x + box.width * (0.1 + 0.8 * Math.random());
      const y = box.y + box.height * (0.1 + 0.8 * Math.random());
      await p.mouse.move(x, y, { steps: 2 });
      if (Math.random() < 0.6) await p.mouse.click(x, y);
    }
    await p.waitForTimeout(140);
  }
  if (held) await p.keyboard.up(held);
  if (shots) await p.screenshot({ path: path.join(shots, `${id}.png`), timeout: 90_000 }).catch(() => {});
  const wall = (Date.now() - wall0) / 1000;

  const result = await p.evaluate(() => {
    const s = window.__ambleStore.getState();
    return {
      project: s.project,
      runErrors: s.run.errors.map((e) => `${e.target ?? 'Game'}${e.script ? ` (${e.script})` : ''}: ${e.message}`),
      logs: s.run.logs.filter((l) => l.level !== 'log').map((l) => l.message),
      spend: localStorage.getItem('amble:spend'),
    };
  });
  let usd = 0;
  try {
    usd = Object.values(JSON.parse(result.spend).byModel).reduce((n, m) => n + m.usd, 0);
  } catch {
    /* no spend recorded */
  }
  say(`played ${total.toFixed(0)} s of game time in ${wall.toFixed(0)} s (${Math.round((100 * total) / Math.max(1, wall))}% speed here)${ends.length ? `; ended: ${ends.join(', ')}` : ''}; cost $${usd.toFixed(3)}`);
  const problems = [...new Set([...result.runErrors, ...result.logs, ...pageErrors])];
  for (const e of problems) say(`problem: ${e}`);
  await context.close();

  if (total < Math.min(playSeconds, 20)) problems.push('it barely played');
  Object.assign(record, { usd, playedSeconds: total, wallSeconds: wall, ends, problems });
  if (problems.length && !force) {
    // Kept beside the pictures for a look at what went wrong (never shipped).
    if (shots) writeFileSync(path.join(shots, `${id}.rejected.amble`), JSON.stringify(result.project));
    return { id, ok: false, usd, lines: [...lines, '   NOT written (problems while playing; --force writes it anyway).'] };
  }
  const file = path.join(outDir, `${id}.amble`);
  writeFileSync(file, JSON.stringify(result.project));
  return { id, ok: true, usd, lines: [...lines, `   wrote ${path.relative(root, file)}`] };
}

// --skip-existing: leave out builds already in --out (a retry after a run that stopped partway).
const queue = ids.filter((x) => (!only.length || only.includes(x)) && !(args.includes('--skip-existing') && existsSync(path.join(outDir, `${x}.amble`))));
let failures = 0;
let spent = 0;
const worker = async () => {
  for (;;) {
    const id = queue.shift();
    if (!id) return;
    let res;
    try {
      res = await build(id);
    } catch (err) {
      res = { id, ok: false, lines: [`   FAILED: ${err.message}`] };
    }
    console.log(`\n== ${res.id}\n${res.lines.join('\n')}`);
    if (!res.ok) failures++;
    spent += res.usd ?? 0;
    // Written after every build too, so what was paid for is kept if a later one fails.
    if (report) writeFileSync(report, JSON.stringify({ model, effort, playSeconds, at: new Date().toISOString(), results }, null, 2));
  }
};
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
console.log(`\n${failures ? `${failures} not written. ` : ''}Total cost $${spent.toFixed(2)}.`);
if (report) writeFileSync(report, JSON.stringify({ model, effort, playSeconds, at: new Date().toISOString(), results }, null, 2));
await browser.close();
process.exit(failures ? 1 : 0);
