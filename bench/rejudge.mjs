#!/usr/bin/env node
/** The judge's noise: judges the given builds again, n times each, without saving. node bench/rejudge.mjs <run/model dir>... [--n 3] */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const n = Number(args.includes('--n') ? args[args.indexOf('--n') + 1] : 3);
const dirs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--n');
const src = readFileSync(path.join(here, 'judge.mjs'), 'utf8');
// Reuse judge.mjs's request (its SCHEMA and judge()), without its file walk and without writing judge.json.
const body = src.slice(src.indexOf('const SCHEMA'), src.indexOf('const jobs = []')) + src.slice(src.indexOf('async function judge'), src.indexOf('let spent = 0'));
const mod = await import('data:text/javascript,' + encodeURIComponent(`import { existsSync, readFileSync, writeFileSync } from 'node:fs'; import path from 'node:path'; const judgeModel = 'anthropic/claude-sonnet-5.5'; const ideas = JSON.parse(readFileSync(${JSON.stringify(path.join(here, 'ideas.json'))}, 'utf8'));\n${body.replace("writeFileSync(path.join(dir, 'judge.json')", '(() => {})(path.join(dir, \'judge.json\')')}\nexport { judge };`));
for (const d of dirs) {
  const dir = path.join(here, 'results-harness', d);
  const scores = await Promise.all(Array.from({ length: n }, () => mod.judge({ dir, id: 'countdown-chickens', amble: path.join(dir, 'countdown-chickens.amble') }).then((s) => s.overall).catch((e) => `x(${e.message.slice(0, 40)})`)));
  const saved = JSON.parse(readFileSync(path.join(dir, 'judge.json'), 'utf8')).overall;
  console.log(d.padEnd(36), 'saved', saved, ' again', scores.join(', '));
}
