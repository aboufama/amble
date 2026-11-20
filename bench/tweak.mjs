#!/usr/bin/env node
/**
 * Quick-change benchmark: a game already built gets a wish typed into "Change something…", the way a
 * kid would, and we time the build of that change, then play the game for a few seconds and count
 * what goes wrong. Each wish starts from the same game, in a page of its own.
 *
 *   OPENROUTER_API_KEY=... PW_CHROMIUM_PATH=... node bench/tweak.mjs --game <file.amble> --label edits \
 *     --harness '{"edits":true}' [--url http://localhost:5207] [--model openai/gpt-6.2-sol] [--effort low]
 *
 * Writes bench/results-tweak/<label>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = opt('url', 'http://localhost:5207');
const model = opt('model', 'openai/gpt-6.2-sol');
const effort = opt('effort', 'low');
const label = opt('label', 'tweak');
const harness = opt('harness', '{}');
const game = JSON.parse(readFileSync(opt('game', ''), 'utf8'));
const WISHES = opt('wishes', '')
  ? opt('wishes', '').split('|')
  : ['make the chickens twice as fast', 'make the countdown shorter', 'add a golden egg that gives a bonus when you grab it', 'make the music quieter'];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
for (const wish of WISHES) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, ignoreHTTPSErrors: true });
  await context.addInitScript((h) => {
    if (window !== window.top) return;
    localStorage.setItem('amble:start', 'seen');
    window.__ambleHarness = JSON.parse(h);
    window.__ambleTrace = [];
  }, harness);
  const p = await context.newPage();
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.goto(url, { timeout: 240_000 });
  await p.waitForSelector('.blocklyMainBackground', { timeout: 300_000 });
  const r = await p.evaluate(
    async ({ game, wish, model, effort }) => {
      const store = window.__ambleStore;
      const actions = await import('/src/actions.ts');
      const { migrateProject } = await import('/src/project/migrate.ts');
      const { compileNeedsRequest } = await import('/src/compiler/compile.ts');
      store.getState().closeHome();
      store.getState().setSettings({ apiKey: '', useChatGpt: false, model, reasoningEffort: effort, assetModel: model, artMode: 'svg' });
      store.getState().setProject(migrateProject(game));
      await new Promise((r) => setTimeout(r, 1500));
      const before = new Map(store.getState().project.compiled.code.map((c) => [c.targetName, c.source]));
      const stale = compileNeedsRequest(store.getState().project);
      const until = async (ok, ms) => {
        for (let t = 0; t < ms && !ok(); t += 50) await new Promise((r) => setTimeout(r, 50));
      };
      const t = performance.now();
      actions.addWish(wish);
      await until(() => store.getState().compile.status === 'running', 5000);
      await until(() => store.getState().compile.status !== 'running', 240_000);
      const seconds = (performance.now() - t) / 1000;
      const s = store.getState();
      // Play the changed game for a few seconds (the wish starts it once it is built).
      await new Promise((r) => setTimeout(r, 8000));
      const after = store.getState();
      const changed = after.project.compiled.code.filter((c) => before.get(c.targetName) !== c.source).map((c) => c.targetName);
      return {
        wish,
        stale,
        seconds,
        status: s.compile.status,
        error: s.compile.error,
        warnings: after.project.compiled.warnings,
        changed,
        runErrors: after.run.errors.map((e) => `${e.target ?? 'Game'}${e.script ? ` (${e.script})` : ''}: ${e.message}`),
        logs: after.run.logs.filter((l) => l.level !== 'log').map((l) => l.message),
        trace: (window.__ambleTrace ?? []).map((e) => ({ ...e, t0: Math.round(e.t0 - t), ms: Math.round(e.ms ?? 0), first: e.first === undefined ? null : Math.round(e.first) })),
        usd: (() => {
          try {
            return Object.values(JSON.parse(localStorage.getItem('amble:spend')).byModel).reduce((n, m) => n + m.usd, 0);
          } catch {
            return 0;
          }
        })(),
      };
    },
    { game, wish, model, effort },
  );
  r.problems = [...new Set([...r.runErrors, ...r.logs, ...pageErrors])];
  results.push(r);
  console.log(`${label}: "${wish}": ${r.seconds.toFixed(1)} s, ${r.status}${r.error ? ` (${r.error})` : ''}, changed ${r.changed.join(', ') || 'nothing'}, ${r.problems.length} problems, $${r.usd.toFixed(4)}${r.stale ? ' (the game needed building before the wish!)' : ''}`);
  for (const w of r.warnings) console.log(`   warning: ${w}`);
  for (const e of r.problems) console.log(`   problem: ${e}`);
  await context.close();
}
await browser.close();
mkdirSync(path.join(here, 'results-tweak'), { recursive: true });
writeFileSync(path.join(here, 'results-tweak', `${label}.json`), JSON.stringify({ label, model, effort, harness: JSON.parse(harness), results }, null, 2));
