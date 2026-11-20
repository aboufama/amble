#!/usr/bin/env node
/** Speed rounds side by side: each label's builds (bench/speed.mjs), their seconds, cost and the judge's scores. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results-harness');
const by = new Map();
for (const run of readdirSync(root)) {
  const m = /^([a-z]+\d+[a-z]?)-(.+)-r(\d+)$/.exec(run);
  if (!m) continue;
  for (const d of readdirSync(path.join(root, run))) {
    const dir = path.join(root, run, d);
    if (!existsSync(path.join(dir, 'report.json'))) continue;
    const r = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8')).results?.[0];
    if (!r) continue;
    const j = existsSync(path.join(dir, 'judge.json')) ? JSON.parse(readFileSync(path.join(dir, 'judge.json'), 'utf8')) : null;
    const usd = (r.trace ?? []).reduce((a, t) => a + (t.usd ?? 0), 0);
    if (!by.has(m[1])) by.set(m[1], []);
    by.get(m[1]).push({ idea: m[2], rep: m[3], s: r.buildSeconds, ok: r.status === 'done', usd, overall: j?.overall ?? null, j });
  }
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
for (const [label, rows] of [...by].sort()) {
  const done = rows.filter((r) => r.ok);
  const scored = rows.filter((r) => r.overall != null);
  const sorted = done.map((r) => r.s).sort((a, b) => a - b);
  console.log(`${label.padEnd(5)} n=${rows.length} built=${done.length}  mean ${mean(sorted).toFixed(1)} s  median ${sorted[Math.floor(sorted.length / 2)]?.toFixed(1)} s  $${mean(done.map((r) => r.usd)).toFixed(3)}  judge ${mean(scored.map((r) => r.overall)).toFixed(2)} (${scored.map((r) => r.overall).join(',')})`);
  for (const r of rows.sort((a, b) => a.idea.localeCompare(b.idea) || a.rep - b.rep)) {
    const score = r.j ? `overall ${r.j.overall} (fidelity ${r.j.fidelity}, scope ${r.j.scope}, polish ${r.j.polish}, soundness ${r.j.soundness})` : '';
    console.log(`      ${r.idea.padEnd(20)} r${r.rep} ${r.ok ? `${r.s.toFixed(1).padStart(5)} s` : ' failed'}  ${score}`);
  }
}
