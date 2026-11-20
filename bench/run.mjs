#!/usr/bin/env node
/**
 * Model benchmark: builds every idea in bench/ideas.json with each model below, through the dev
 * server (started with OPENAI_BASE_URL=https://openrouter.ai/api/v1 and an OpenRouter key), using
 * scripts/precompile-demos.mjs for the build and the bot's play. Results go to bench/results/<model>/.
 *
 *   OPENROUTER_API_KEY=... node bench/run.mjs [--url http://localhost:5199] [--only id1,id2] [--parallel 4] [--floor 4]
 *
 * Before each model starts it checks the account's remaining OpenRouter credit and stops starting
 * new models below --floor dollars.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const url = opt('url', 'http://localhost:5199');
const parallel = Number(opt('parallel', '4'));
const floor = Number(opt('floor', '4'));
const ideasOnly = opt('ideas-only', 'countdown-chickens,gravity-librarian');

// [OpenRouter id, reasoning effort]. The flagship-priced ones run at low effort to stay in budget.
const MODELS = [
  ['openai/gpt-6.1-terra', 'high'], // Amble's current Best (baseline)
  ['openai/gpt-6-luna', 'high'], // Amble's current Efficient (baseline)
  ['openai/gpt-6.2-sol', 'medium'],
  ['openai/gpt-6.2-astra', 'low'],
  ['google/gemini-4-neon', 'medium'],
  ['google/gemini-4-hydrogen', 'high'],
  ['google/gemini-4-carbon', 'medium'],
  ['google/gemini-4-argon', 'medium'],
  ['meta/muse-wonder', 'medium'],
  ['anthropic/claude-fable-5.2', 'low'],
  ['anthropic/claude-sonnet-5.5', 'medium'],
  ['anthropic/claude-haiku-5.5', 'high'],
  ['moonshotai/kimi-k3.1-pro', 'medium'],
  ['qwen/qwen4-max', 'medium'],
  ['deepseek/deepseek-v4.1-flash', 'high'],
  ['minimax/minimax-m3.1-flash', 'high'],
];
const only = opt('only', '').split(',').filter(Boolean);
// --models id:effort,id:effort runs these instead of the list above.
const custom = opt('models', '')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [m, e = 'medium'] = s.split(':');
    return [m, e];
  });
const queue = (custom.length ? custom : MODELS).filter(([m]) => !only.length || only.includes(m));

async function remaining() {
  const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
  const { data } = await r.json();
  return data.total_credits - data.total_usage;
}

function runModel([model, effort]) {
  const dir = path.join(here, 'results', model.replace('/', '__'));
  mkdirSync(dir, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(here, '..', 'scripts', 'precompile-demos.mjs'), '--url', url, '--model', model, '--effort', effort, '--ideas', path.join(here, 'ideas.json'), '--only', ideasOnly, '--play', '60', '--jobs', opt('jobs', '2'), '--force', '--skip-existing', '--out', dir, '--report', path.join(dir, 'report.json')],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      console.log(`\n##### ${model} (${effort}) exit ${code}\n${out.trim()}`);
      resolve();
    });
  });
}

const worker = async () => {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    const left = await remaining().catch(() => Infinity);
    if (left < floor) {
      console.log(`\n##### skipped ${next[0]}: $${left.toFixed(2)} credit left (floor $${floor})`);
      continue;
    }
    // --max-load <n>: wait until this computer's 1-minute load average is under n before starting
    // (the headless browsers that play the games are what overload it, not the API).
    const maxLoad = Number(opt('max-load', '0'));
    while (maxLoad && os.loadavg()[0] > maxLoad) await new Promise((r) => setTimeout(r, 10_000));
    console.log(`starting ${next[0]} ($${left.toFixed(2)} credit left, load ${os.loadavg()[0].toFixed(0)})`);
    await runModel(next);
  }
};
// --stagger <s>: workers start this many seconds apart, so the dev server isn't hit by every browser at once.
const stagger = Number(opt('stagger', '0'));
await Promise.all(Array.from({ length: parallel }, (_, i) => new Promise((r) => setTimeout(r, i * stagger * 1000)).then(worker)));
console.log(`\nDone. $${(await remaining()).toFixed(2)} credit left.`);
