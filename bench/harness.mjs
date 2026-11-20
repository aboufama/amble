#!/usr/bin/env node
/**
 * Harness benchmark: builds one idea with each finalist model under each harness variant (see
 * src/compiler/harness.ts), through the dev server, and keeps every build, its trace and its play
 * in bench/results-harness/<variant>/<model>/.
 *
 *   OPENROUTER_API_KEY=... node bench/harness.mjs [--variants v0,v1] [--models a,b] [--rep 1] [--parallel 3] [--max-load 20]
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

import { VARIANTS } from './variants.mjs';

const MODELS = { 'google/gemini-4-hydrogen': 'high', 'openai/gpt-6.1-terra': 'high', 'openai/gpt-6.2-sol': 'medium' };

const variants = opt('variants', Object.keys(VARIANTS).join(',')).split(',');
const models = opt('models', Object.keys(MODELS).join(',')).split(',');
const rep = opt('rep', '1');
const idea = opt('idea', 'countdown-chickens');
const parallel = Number(opt('parallel', '3'));
const maxLoad = Number(opt('max-load', '20'));
const play = opt('play', '45');

const queue = [];
for (const v of variants) for (const m of models) queue.push({ v, m });

function run({ v, m }) {
  const dir = path.join(here, 'results-harness', `${v}-r${rep}`, m.replace('/', '__'));
  if (existsSync(path.join(dir, 'report.json'))) return Promise.resolve();
  mkdirSync(dir, { recursive: true });
  const h = VARIANTS[v].harness;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(here, '..', 'scripts', 'precompile-demos.mjs'), '--url', VARIANTS[v].url ?? opt('url', 'http://localhost:5200'), '--model', m, '--effort', MODELS[m], '--ideas', path.join(here, 'ideas.json'), '--only', idea, '--play', play, '--jobs', '1', '--force', '--out', dir, '--report', path.join(dir, 'report.json'), '--harness', JSON.stringify(h), ...(VARIANTS[v].assetModel ? ['--asset-model', VARIANTS[v].assetModel] : [])],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      console.log(`\n##### ${v}-r${rep} ${m} exit ${code}\n${out.trim()}`);
      resolve();
    });
  });
}

// One build per model at a time: OpenRouter caps a new account at 20 requests a minute per model,
// so two builds of one model would slow each other down (and that would measure the cap, not the harness).
const busy = new Set();
const lockOf = (m) => path.join(here, 'results-harness', `.busy-${m.replace('/', '__')}`);
const worker = async (i) => {
  await new Promise((r) => setTimeout(r, i * 15_000));
  for (;;) {
    if (!queue.length) return;
    // (Builds another run started count too: a lock file per model, taken atomically.)
    const elsewhere = execSync('ps -eo args').toString();
    let at = -1;
    for (let k = 0; k < queue.length && at < 0; k++) {
      const m = queue[k].m;
      if (busy.has(m) || elsewhere.includes(`--model ${m} `)) continue;
      try {
        closeSync(openSync(lockOf(m), 'wx'));
        at = k;
      } catch {
        /* another run has it */
      }
    }
    if (at < 0) {
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    const [next] = queue.splice(at, 1);
    busy.add(next.m);
    while (os.loadavg()[0] > maxLoad) await new Promise((r) => setTimeout(r, 5_000));
    console.log(`starting ${next.v}-r${rep} ${next.m} (load ${os.loadavg()[0].toFixed(0)})`);
    try {
      await run(next);
    } finally {
      busy.delete(next.m);
      rmSync(lockOf(next.m), { force: true });
    }
  }
};
await Promise.all(Array.from({ length: parallel }, (_, i) => worker(i)));
console.log('\nDone.');
