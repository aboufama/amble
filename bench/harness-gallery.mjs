#!/usr/bin/env node
/**
 * Turns bench/results-harness into the Harness Lab page's data: data.json (every build with its
 * timing, cost, errors and request timeline) and one playable page per game, in $LAB_DIR.
 *
 *   LAB_DIR=... node bench/harness-gallery.mjs [--url http://localhost:5200]
 */
import { chromium } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS } from './variants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--url');
const url = i >= 0 ? args[i + 1] : 'http://localhost:5200';
const results = path.join(here, 'results-harness');
const site = process.env.LAB_DIR;
if (!site) throw new Error('Set LAB_DIR.');
mkdirSync(path.join(site, 'games'), { recursive: true });

// Gemini's first streamed runs came before the fix that put the asset list first for Gemini too
// (it writes fields in the order of "required"), so their art never streamed: they don't count.
// And a baseline run that overlapped another build of its model by mistake: the per-minute rate limit
// it shared turned 6 of its costumes into placeholders, which would count against today's harness unfairly.
// (v15 and v16 are left out whole: their stage-helper check flagged the engine's own this._script() in
// every build, so each paid for a fix it didn't need; v18 is the same harness with that fixed.)
// (v31 run 1 ran out of OpenRouter credit part way: 7 of its drawings were refused, which says nothing about the harness.)
const SUPERSEDED = new Set(['v4-r1/google__gemini-4-hydrogen', 'v5-r1/google__gemini-4-hydrogen', 'v0-r3/openai__gpt-6.2-sol', 'v31-r1/openai__gpt-6.2-sol']);

// The bench's own setup line once ran in the game's sandboxed frame too: its error isn't the game's.
const NOISE = /localStorage' property from 'Window'/;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.addInitScript(() => window === window.top && localStorage.setItem('amble:start', 'seen'));
await page.goto(url, { timeout: 240_000 });
await page.waitForSelector('.blocklyMainBackground', { timeout: 240_000 });
const engine = await page.evaluate(async () => {
  const { playerScriptUrl } = await import('/src/player/host.ts');
  return (await fetch(playerScriptUrl())).text();
});
writeFileSync(path.join(site, 'games', 'amble-player.js'), engine);

const builds = [];
for (const run of readdirSync(results).sort()) {
  const m = /^(v\d+)-r(\d+)$/.exec(run);
  if (!m || !VARIANTS[m[1]] || m[2] === '0') continue;
  for (const d of readdirSync(path.join(results, run))) {
    const dir = path.join(results, run, d);
    const reportFile = path.join(dir, 'report.json');
    if (!existsSync(reportFile) || SUPERSEDED.has(`${run}/${d}`) || /^v1[56]-/.test(run)) continue;
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    for (const r of report.results) {
      const key = `${run}__${d}__${r.id}`;
      const trace = (r.trace ?? []).map((e) => ({ kind: e.kind, schema: e.schema, t0: e.t0, ms: e.ms, first: e.first, output: e.output ?? 0, reasoning: e.reasoning ?? 0, usd: e.usd ?? 0, error: e.error ?? null }));
      const traced = trace.reduce((n, e) => n + (e.usd || 0), 0);
      const warnings = r.warnings ?? [];
      const entry = {
        key,
        variant: m[1],
        rep: Number(m[2]),
        label: VARIANTS[m[1]].label,
        harness: VARIANTS[m[1]].harness,
        model: report.model,
        idea: r.id,
        status: r.status,
        error: r.error,
        title: null,
        how: r.how ?? '',
        cast: r.cast ?? [],
        assets: r.assets ?? 0,
        buildSeconds: Math.round(r.buildSeconds ?? 0),
        usd: traced || r.usd || 0,
        problems: (r.problems ?? []).filter((x) => !NOISE.test(x)),
        placeholders: warnings.filter((w) => /used a placeholder/.test(w)).length,
        fixed: warnings.filter((w) => /^(Fixed before the first run|Reviewed and fixed): /.test(w)).map((w) => w.replace(/^Fixed before the first run: /, '').replace(/^Reviewed and fixed: (.*)$/, 'The review fixed: $1')),
        warnings: warnings.filter((w) => !/^(Fixed before the first run|Reviewed and fixed): /.test(w)),
        trace,
        picture: null,
        playable: false,
      };
      const amble = path.join(dir, `${r.id}.amble`);
      if (r.status === 'done' && existsSync(amble)) {
        const project = JSON.parse(readFileSync(amble, 'utf8'));
        entry.title = project.title;
        // How much game it is: the size of the cast, the art, the sounds and the code.
        const c = project.compiled ?? {};
        entry.size = {
          cast: (c.sprites ?? []).length,
          images: (c.assets ?? []).filter((a) => a.kind === 'image').length,
          sounds: (c.assets ?? []).filter((a) => a.kind === 'sound').length,
          code: (c.code ?? []).reduce((n, x) => n + (x.source ?? '').length, 0),
        };
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
      // The blind judge's scores (bench/judge.mjs), when it has judged this build.
      const judgeFile = path.join(dir, 'judge.json');
      if (existsSync(judgeFile)) {
        const j = JSON.parse(readFileSync(judgeFile, 'utf8'));
        entry.judge = { overall: j.overall, fidelity: j.fidelity, scope: j.scope, polish: j.polish, soundness: j.soundness, notes: j.notes, by: j.judge };
      }
      const jpg = path.join(dir, `${r.id}.jpg`);
      if (existsSync(jpg)) {
        copyFileSync(jpg, path.join(site, 'games', `${key}.jpg`));
        entry.picture = `games/${key}.jpg`;
      }
      builds.push(entry);
    }
  }
}
await browser.close();
const variants = Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, { label: v.label, harness: v.harness }]));
// Quick changes (bench/tweak.mjs): each wish's build time, what it changed and what went wrong.
const tweakDir = path.join(here, 'results-tweak');
const tweaks = existsSync(tweakDir)
  ? readdirSync(tweakDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const t = JSON.parse(readFileSync(path.join(tweakDir, f), 'utf8'));
        return {
          label: t.label,
          model: t.model,
          harness: t.harness,
          results: t.results.map((r) => ({ wish: r.wish, seconds: Math.round(r.seconds * 10) / 10, status: r.status, changed: r.changed, problems: (r.problems ?? []).filter((x) => !NOISE.test(x)), warnings: r.warnings ?? [], usd: r.usd, requests: (r.trace ?? []).length, output: (r.trace ?? []).reduce((n, e) => n + (e.output ?? 0), 0) })),
        };
      })
  : [];
// Round two (Sol): what changed, in the order it was found.
const round2 = [
  { title: 'Sprites build on each other’s classes', html: 'In round one, 4 of 6 judged Sol games gave their variant chickens Hen’s behavior by borrowing it (<code>Hen.prototype.update.call(this)</code>): not defined in Amble, so a fix request each time, and the judge’s top soundness complaint. The engine now puts every sprite’s class in scope for every class and loads them in order, so <code>class Skater extends Hen</code> just works (a class used before it loads is a stand-in that becomes it). The models use it at once, and the check gives the new sprite any costumes its base’s code uses.' },
  { title: 'The cast first, then the code', html: 'The reply starts with a compact cast: each character’s name, look and a few words per costume pose, then backdrops and sounds in a few words, then the code. A streaming reader starts each character’s drawing as soon as its entry is written, about 3 seconds in, where round one’s long asset list kept the art waiting 10 to 23 seconds. Costumes a class uses that the cast left out start as soon as that class is written.' },
  { title: 'No trial run', html: 'In 34 builds with it on, the trial run found nothing: the check before it did all the catching. On a build whose art finishes before its code, it was 6 seconds of waiting, so it is off.' },
  { title: 'The fast endpoint for the code', html: 'Build time is mostly how fast the provider writes. OpenRouter serves Sol from OpenAI (75–115 tokens a second today) and Azure (180–230, the same price), and its <code>order</code> setting alone didn’t move requests to Azure; <code>only</code> with <code>order</code> does. The code request, the one the build waits for, can also go to OpenAI’s ultrafast endpoint (about 300 a second, three times the price).' },
  { title: 'Design rules from the judge’s notes', html: 'A boss plays differently (a move to learn, a tell, a weakness), the HUD stays on the edges on a dark band, nothing big is painted over the backdrop, and the reply checks its numbers (each act’s length, counts and speeds, and why a good player wins) before the code. The judge now praises the bosses; its last doubt, balance it can’t play, stays.' },
  { title: 'Fixes', html: 'The check flagged <code>this.destroy()</code> inside a generator handed to a sprite’s <code>run</code> as a stage call (it is the sprite’s), costing a needless fix; it now tells whose <code>this</code> it is. And a class that names one loading after it failed with “is not defined” (v23 run 1), now fixed.' },
  { title: 'Quality: a bigger game, not more thinking', html: 'Low reasoning writes terse code, about 9–10k characters where Amble’s old harness wrote 15–16k, and that is what the judge marked down (scope, polish). Medium reasoning didn’t help (7, 8, 7 at 2.5 times the time). Spelling out what a full game of that size has (power-ups, juice on every event, a styled HUD, a boss with phases, 350–500 lines) did: v30 judged 8, 8, 7, with polish 8 in every run. It writes twice the code, so it takes 31–51 seconds; that switch (<code>fullSize</code>) is off by default.' },
  { title: 'Tried and set aside', html: 'Fan-out (an outline, then the stage and the cast written at once): as slow, because the stage script stays on the critical path and the outline adds to it, and dearer. Two writers for the full-size game (the cast’s classes written from the reply’s header while it writes the stage): first the stage took everything and the cast came back empty; told to split the work, it built a bigger game (26k characters) but not a faster one, since the contract it needs made the header 24 seconds. The ultrafast endpoint for the code: 190–230 tokens a second inside a build, hardly faster than Azure, at three times the price. Terra drawing at half the price: faster, but plainer scenes (polish 6 to 7).' },
];
writeFileSync(path.join(site, 'data.json'), JSON.stringify({ at: new Date().toISOString(), final2: process.env.FINAL2 || 'v27', round2, variants, builds, tweaks }, null, 1));
const files = ['data.json', ...readdirSync(path.join(site, 'games')).sort().map((f) => `games/${f}`)];
writeFileSync(path.join(site, 'files.json'), JSON.stringify(files));
console.log(`${builds.length} builds, ${builds.filter((b) => b.playable).length} playable`);
