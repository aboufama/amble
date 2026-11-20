#!/usr/bin/env node
/**
 * Turns bench/results into a playable gallery in bench/site: one small page per game (its package
 * plus the shared engine, amble-player.js), each game's picture, and data.json with every build's
 * numbers. Needs the dev server (it builds the packages with Amble's own code in a headless page).
 *
 *   node bench/gallery.mjs [--url http://localhost:5199]
 */
import { chromium } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--url');
const url = i >= 0 ? args[i + 1] : 'http://localhost:5199';
const results = path.join(here, 'results');
const site = process.env.ARCADE_DIR || path.join(here, 'site');
mkdirSync(path.join(site, 'games'), { recursive: true });
const ideas = JSON.parse(readFileSync(path.join(here, 'ideas.json'), 'utf8'));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.addInitScript(() => window === window.top && localStorage.setItem('amble:start', 'seen'));
await page.goto(url, { timeout: 240_000 });
await page.waitForSelector('.blocklyMainBackground', { timeout: 60_000 });

const engine = await page.evaluate(async () => {
  const { playerScriptUrl } = await import('/src/player/host.ts');
  return (await fetch(playerScriptUrl())).text();
});
writeFileSync(path.join(site, 'games', 'amble-player.js'), engine);

const games = [];
for (const d of readdirSync(results)) {
  const dir = path.join(results, d);
  const reportFile = path.join(dir, 'report.json');
  // The first smoke test (Gemini 4 Hydrogen) stands in until that model's own run finishes.
  if (d === 'smoke' && existsSync(path.join(results, 'google__gemini-4-hydrogen', 'report.json'))) continue;
  if (!existsSync(reportFile)) continue;
  // A retry keeps the earlier run's report beside it (report.<time>.json): the latest result per idea wins.
  const reports = readdirSync(dir).filter((f) => /^report(\.\d+)?\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  const report = reports.find((x) => x.model) ?? reports[0];
  const latest = new Map();
  for (const rep of [...reports.filter((x) => x !== reports[0]), reports[0]]) for (const r of rep.results) if (r.status === 'done' || !latest.has(r.id)) latest.set(r.id, r);
  for (const r of latest.values()) {
    const key = `${d}__${r.id}`;
    const entry = {
      key,
      model: report.model,
      effort: report.effort,
      idea: r.id,
      status: r.status,
      error: r.error,
      title: null,
      how: r.how ?? '',
      cast: r.cast,
      assets: r.assets,
      buildSeconds: Math.round(r.buildSeconds),
      usd: r.usd ?? 0,
      played: Math.round(r.playedSeconds ?? 0),
      // The bot's sandboxed player frame reports every localStorage read as a page error: harness noise, not the model's.
      problems: (r.problems ?? []).filter((x) => !/localStorage' property from 'Window'/.test(x)),
      picture: null,
      playable: false,
    };
    const amble = path.join(dir, `${r.id}.amble`);
    if (r.status === 'done' && existsSync(amble)) {
      const project = JSON.parse(readFileSync(amble, 'utf8'));
      entry.title = project.title;
      const pkg = await page.evaluate(async (p) => {
        const { buildRunPackage } = await import('/src/player/package.ts');
        return JSON.stringify(buildRunPackage(p)).replace(/</g, '\\u003c');
      }, project);
      writeFileSync(
        path.join(site, 'games', `${key}.html`),
        `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${(project.title || 'Amble game').replace(/[<&"]/g, '')}</title>\n<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>\n</head>\n<body>\n<script type="application/json" id="amble-package">${pkg}</script>\n<script src="amble-player.js"></script>\n</body>\n</html>\n`,
      );
      entry.playable = true;
    }
    const jpg = path.join(dir, `${r.id}.jpg`);
    if (existsSync(jpg)) {
      copyFileSync(jpg, path.join(site, 'games', `${key}.jpg`));
      entry.picture = `games/${key}.jpg`;
    }
    games.push(entry);
  }
}
await browser.close();
writeFileSync(path.join(site, 'data.json'), JSON.stringify({ at: new Date().toISOString(), ideas, games }, null, 1));
console.log(`${games.length} builds, ${games.filter((g) => g.playable).length} playable; engine ${(engine.length / 1e6).toFixed(1)} MB`);
