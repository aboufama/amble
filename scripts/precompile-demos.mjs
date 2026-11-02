#!/usr/bin/env node
/**
 * Builds the demos once, for real, and ships them built: each example marked `prebuilt` in
 * src/project/examples.ts is compiled by the model (code, the compiler's characters, art and
 * sounds), played for a while to catch problems, and saved with its compiled game to
 * public/demos/<id>.amble. File > Examples then opens it ready to play, with no request.
 *
 * Needs the dev server running with a key (it uses the editor itself, in a headless browser):
 *
 *   OPENAI_API_KEY=sk-... npx vite --port 5173
 *   node scripts/precompile-demos.mjs --url http://localhost:5173 [--model gpt-6.1-terra] [--effort xhigh] [--only neon-drift,sky-whale]
 *
 * A demo whose build fails, or whose game reports errors while it plays, isn't written (use
 * --force to write it anyway). Screenshots go to --shots (default: none).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const effort = opt('effort', 'xhigh');
const only = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const shots = opt('shots', '');
const force = args.includes('--force');
const playSeconds = Number(opt('play', '14'));

const outDir = path.join(root, 'public', 'demos');
mkdirSync(outDir, { recursive: true });
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let failures = 0;

const config = await (await fetch(new URL('api/config', url))).json().catch(() => ({}));
if (!config.serverKey) {
  console.error(`The dev server at ${url} has no OPENAI_API_KEY. Start it with one (see the top of this file).`);
  process.exit(1);
}

const page = await context.newPage();
await page.goto(url);
await page.waitForSelector('.blocklyMainBackground', { timeout: 60_000 });
const ids = await page.evaluate(async () => {
  const { EXAMPLES } = await import('/src/project/examples.ts');
  return EXAMPLES.filter((e) => e.prebuilt).map((e) => e.id);
});
await page.close();

for (const id of ids.filter((x) => !only.length || only.includes(x))) {
  const p = await context.newPage();
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(e.message));
  await p.goto(url);
  await p.waitForSelector('.blocklyMainBackground', { timeout: 60_000 });
  const t0 = Date.now();
  console.log(`\n== ${id}: building with ${model} (${effort} reasoning)...`);
  const built = await p.evaluate(
    async ({ id, model, effort }) => {
      const store = window.__ambleStore;
      const { EXAMPLES } = await import('/src/project/examples.ts');
      const actions = await import('/src/actions.ts');
      store.getState().setSettings({ apiKey: '', useChatGpt: false, model, reasoningEffort: effort, assetModel: model, artMode: 'svg' });
      store.getState().setProject(EXAMPLES.find((e) => e.id === id).make());
      await new Promise((r) => setTimeout(r, 1500));
      await actions.compile(undefined, { fresh: true });
      const s = store.getState();
      return { status: s.compile.status, error: s.compile.error, warnings: s.project.compiled?.warnings ?? [], questions: (s.project.compiled?.questions ?? []).map((q) => q.text) };
    },
    { id, model, effort },
  );
  console.log(`   built in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${built.status}${built.error ? ` (${built.error})` : ''}`);
  for (const w of built.warnings) console.log(`   warning: ${w}`);
  for (const q of built.questions) console.log(`   question: ${q}`);

  // Play it: steer, fire, jump, click around, so most of the code runs.
  const frame = await p.waitForSelector('iframe.player-frame');
  const box = await frame.boundingBox();
  const steps = Math.max(1, Math.round(playSeconds / 2));
  for (let i = 0; i < steps && box; i++) {
    await p.mouse.move(box.x + box.width * (0.3 + 0.4 * Math.random()), box.y + box.height * (0.2 + 0.6 * Math.random()), { steps: 8 });
    await p.mouse.click(box.x + box.width * (0.2 + 0.6 * Math.random()), box.y + box.height * (0.15 + 0.3 * Math.random()));
    await p.keyboard.down(i % 2 ? 'ArrowRight' : 'Space');
    await p.waitForTimeout(700);
    await p.keyboard.up(i % 2 ? 'ArrowRight' : 'Space');
    await p.keyboard.press('Space');
    await p.waitForTimeout(1300);
  }
  if (shots) await p.screenshot({ path: path.join(shots, `${id}.png`) });

  const result = await p.evaluate(() => {
    const s = window.__ambleStore.getState();
    return {
      project: s.project,
      runErrors: s.run.errors.map((e) => `${e.target ?? 'Game'}${e.script ? ` (${e.script})` : ''}: ${e.message}`),
      logs: s.run.logs.filter((l) => l.level !== 'log').map((l) => l.message),
      spend: localStorage.getItem('amble:spend'),
    };
  });
  const problems = [...result.runErrors, ...result.logs, ...pageErrors];
  for (const e of problems) console.log(`   problem: ${e}`);
  const c = result.project.compiled;
  console.log(`   ${c?.pieces?.length ?? 0} pieces, characters added: ${(c?.sprites ?? []).map((s) => s.name).join(', ') || 'none'}, art and sounds: ${c?.assets?.length ?? 0}`);

  if (built.status !== 'done' || !c || (problems.length && !force)) {
    failures++;
    console.log(`   NOT written${built.status === 'done' ? ' (problems while playing; --force writes it anyway)' : ''}.`);
  } else {
    const file = path.join(outDir, `${id}.amble`);
    writeFileSync(file, JSON.stringify(result.project));
    console.log(`   wrote ${path.relative(root, file)}`);
  }
  const spend = JSON.parse(result.spend ?? 'null');
  if (spend) console.log(`   spend so far: $${Object.values(spend.byModel).reduce((n, m) => n + m.usd, 0).toFixed(4)}`);
  await p.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
