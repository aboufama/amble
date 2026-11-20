#!/usr/bin/env node
/**
 * Reruns every benchmark model whose builds are missing (no .amble for an idea), once no other run
 * of that model is going. Waits for the computer's load to come down before each model.
 *
 *   OPENROUTER_API_KEY=... node bench/retry.mjs [--parallel 5] [--max-load 24]
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const EFFORT = {
  'openai/gpt-6.1-terra': 'high', 'openai/gpt-6.2-sol': 'medium', 
  'google/gemini-4-neon': 'medium', 'google/gemini-4-hydrogen': 'high', 'google/gemini-4-carbon': 'medium', 'google/gemini-4-argon': 'medium',
  'meta/muse-wonder': 'medium', 'meta/muse-spark-1.3': 'medium', 'anthropic/claude-fable-5.2': 'low', 'anthropic/claude-sonnet-5.5': 'medium',
  'anthropic/claude-haiku-5.5': 'high', 'moonshotai/kimi-k3.1-pro': 'medium', 'qwen/qwen4-max': 'medium',   'minimax/minimax-m3.1-flash': 'high', 'x-ai/grok-4.7': 'medium', 'mistralai/mistral-large-4-0': 'high', 'xiaomi/mimo-v2.6-pro': 'high',
  'qwen/qwen3.8-flash': 'high',
  'z-ai/glm-5.3-flash': 'high', 'nvidia/nemotron-3.5-super-vl': 'high', 'reflection/beam-1.0-501b-a23b': 'high',
  'thinkingmachines/inkling-2-small': 'high', 'cohere/command-a-plus': 'high',
};
const IDEAS = ['countdown-chickens', 'gravity-librarian'];

const running = () => execSync('ps -eo args').toString().split('\n').filter((l) => l.includes('precompile-demos.mjs'));
// Wait for the earlier runs to finish, so nothing is built twice.
while (running().length) {
  console.log(`waiting for ${running().length} earlier runs`);
  await new Promise((r) => setTimeout(r, 30_000));
}

const todo = [];
for (const [model, effort] of Object.entries(EFFORT)) {
  const dir = path.join(here, 'results', model.replace('/', '__'));
  let report = null;
  try {
    report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
  } catch {
    /* none */
  }
  const missing = IDEAS.filter((id) => !existsSync(path.join(dir, `${id}.amble`)) && !(report?.results ?? []).some((r) => r.id === id && r.status !== 'done' && r.error));
  if (!missing.length) continue;
  rmSync(path.join(dir, '.lock'), { force: true });
  // Keep what's there: this run's report replaces report.json, so the old one is kept beside it.
  if (report) execSync(`cp "${path.join(dir, 'report.json')}" "${path.join(dir, `report.${Date.now()}.json`)}"`);
  todo.push(`${model}:${effort}`);
  console.log(`retry ${model}: ${missing.join(', ')}`);
}
if (!todo.length) {
  console.log('Nothing to retry.');
  process.exit(0);
}
const child = spawn(process.execPath, [path.join(here, 'run.mjs'), '--parallel', opt('parallel', '5'), '--stagger', '20', '--jobs', '1', '--max-load', opt('max-load', '24'), '--floor', '2', '--models', todo.join(',')], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code ?? 0));
