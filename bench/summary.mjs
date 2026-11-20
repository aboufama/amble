#!/usr/bin/env node
/** Prints a leaderboard from bench/results/<model>/report.json (finished models only). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const rows = [];
for (const d of readdirSync(dir)) {
  const f = path.join(dir, d, 'report.json');
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  const res = r.results;
  const built = res.filter((x) => x.status === 'done');
  const clean = built.filter((x) => !(x.problems ?? []).length);
  const usd = res.reduce((n, x) => n + (x.usd ?? 0), 0);
  const secs = built.length ? built.reduce((n, x) => n + x.buildSeconds, 0) / built.length : 0;
  rows.push({
    model: r.model,
    effort: r.effort,
    built: `${built.length}/${res.length}`,
    clean: `${clean.length}/${res.length}`,
    score: (built.length + clean.length) / (2 * Math.max(1, res.length)),
    cast: built.length ? (built.reduce((n, x) => n + x.cast.length, 0) / built.length).toFixed(1) : '-',
    assets: built.length ? (built.reduce((n, x) => n + x.assets, 0) / built.length).toFixed(0) : '-',
    sec: secs.toFixed(0),
    usdPerGame: (usd / Math.max(1, res.length)).toFixed(2),
    issues: [...new Set(res.flatMap((x) => [x.error, ...(x.problems ?? [])]).filter(Boolean))].map((s) => s.slice(0, 70)).join(' | '),
  });
}
rows.sort((a, b) => b.score - a.score || a.usdPerGame - b.usdPerGame);
console.log('| model | effort | built | clean play | avg cast | avg assets | build s | $/game | issues |\n|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.model} | ${r.effort} | ${r.built} | ${r.clean} | ${r.cast} | ${r.assets} | ${r.sec} | ${r.usdPerGame} | ${r.issues} |`);
