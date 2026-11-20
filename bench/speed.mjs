#!/usr/bin/env node
/**
 * Speed round: builds each idea (bench/ideas.json) once under one harness, one after the other,
 * through a frozen copy of the code served on its own port, and keeps each build where bench/judge.mjs
 * scores it (bench/results-harness/<label>-<idea>-r<rep>/<model>/). Prints each build's seconds.
 *
 *   PW_CHROMIUM_PATH=... node bench/speed.mjs --label b0 --url http://localhost:5220 [--harness '{}']
 *     [--ideas a,b,c] [--rep 1] [--model openai/gpt-6.2-sol] [--effort low] [--play 30] [--pause 15]
 *
 * One build at a time, with a pause between them: OpenRouter caps this account at 20 Sol requests a
 * minute, and a build over the cap would measure the cap.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const label = opt('label', 'speed');
const url = opt('url', 'http://localhost:5220');
const harness = opt('harness', '{}');
const model = opt('model', 'openai/gpt-6.2-sol');
const effort = opt('effort', 'low');
const rep = opt('rep', '1');
const play = opt('play', '30');
const pause = Number(opt('pause', '15'));
const ideas = opt('ideas', JSON.parse(readFileSync(path.join(here, 'ideas.json'), 'utf8')).map((i) => i.id).join(',')).split(',');

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const rows = [];
for (const [n, idea] of ideas.entries()) {
  const dir = path.join(here, 'results-harness', `${label}-${idea}-r${rep}`, model.replace('/', '__'));
  const report = path.join(dir, 'report.json');
  if (!existsSync(report)) {
    if (n > 0) await sleep(pause);
    mkdirSync(dir, { recursive: true });
    const out = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(here, '..', 'scripts', 'precompile-demos.mjs'), '--url', url, '--model', model, '--effort', effort, '--ideas', path.join(here, 'ideas.json'), '--only', idea, '--play', play, '--jobs', '1', '--force', '--out', dir, '--report', report, '--harness', harness],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      child.on('close', () => resolve(text));
    });
    console.log(`##### ${label} ${idea}\n${String(out).trim().split('\n').slice(-6).join('\n')}`);
  }
  if (!existsSync(report)) {
    rows.push({ idea, seconds: null, status: 'no report' });
    continue;
  }
  const r = JSON.parse(readFileSync(report, 'utf8')).results?.[0] ?? {};
  rows.push({ idea, seconds: r.buildSeconds ?? null, status: r.status ?? '?', errors: r.play?.errors?.length ?? r.errors?.length ?? 0 });
}
console.log(`\n${label}:`);
for (const r of rows) console.log(`  ${r.idea.padEnd(22)} ${r.seconds == null ? '  -  ' : r.seconds.toFixed(1).padStart(5)} s  ${r.status}${r.errors ? `, ${r.errors} errors` : ''}`);
const done = rows.filter((r) => r.seconds != null);
if (done.length) console.log(`  mean ${(done.reduce((a, r) => a + r.seconds, 0) / done.length).toFixed(1)} s over ${done.length}`);
