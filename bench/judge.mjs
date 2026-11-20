#!/usr/bin/env node
/**
 * Blind quality scores for every harness-benchmark build: a judge model that is not one of the
 * contestants reads the game (its idea, cast, art list and code) and looks at a picture of it
 * playing, without knowing which model or harness made it, and scores it. Writes judge.json beside
 * each build's report; builds that have one are skipped.
 *
 *   OPENROUTER_API_KEY=... node bench/judge.mjs [--model anthropic/claude-sonnet-5.5] [--parallel 4]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const judgeModel = opt('model', 'anthropic/claude-sonnet-5.5');
const parallel = Number(opt('parallel', '4'));
const root = path.join(here, 'results-harness');
const ideas = JSON.parse(readFileSync(path.join(here, 'ideas.json'), 'utf8'));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fidelity', 'scope', 'polish', 'soundness', 'overall', 'notes'],
  properties: {
    fidelity: { type: 'integer', description: '1-10: how well the game is the idea it was asked to be.' },
    scope: { type: 'integer', description: '1-10: how much game it is for the "go wild" brief: cast, acts or waves, twists, a boss, an ending.' },
    polish: { type: 'integer', description: '1-10: juice and presentation: feedback, effects, HUD, art and sound use, a look that fits.' },
    soundness: { type: 'integer', description: '1-10: how likely it is to run as intended with no bugs, judging from the code.' },
    overall: { type: 'integer', description: '1-10: overall, as a game a child would make from this idea and show a friend.' },
    notes: { type: 'string', description: 'Two sentences: the strongest and the weakest thing about it.' },
  },
};

const jobs = [];
for (const run of readdirSync(root)) {
  if (!/-r[1-9]\d*$/.test(run)) continue;
  for (const d of readdirSync(path.join(root, run))) {
    const dir = path.join(root, run, d);
    if (!existsSync(path.join(dir, 'report.json')) || existsSync(path.join(dir, 'judge.json'))) continue;
    const report = JSON.parse(readFileSync(path.join(dir, 'report.json'), 'utf8'));
    for (const r of report.results ?? []) {
      const amble = path.join(dir, `${r.id}.amble`);
      if (r.status === 'done' && existsSync(amble)) jobs.push({ dir, id: r.id, amble });
    }
  }
}
console.log(`${jobs.length} builds to judge with ${judgeModel}`);

async function judge({ dir, id, amble }) {
  const project = JSON.parse(readFileSync(amble, 'utf8'));
  const c = project.compiled;
  const idea = ideas.find((i) => i.id === id)?.idea ?? '';
  const text = [
    `The idea, given to an AI game maker on its "go wild" setting (a complete game of about three minutes, with acts or twists and a boss): "${idea}"`,
    `Title: ${c.title ?? project.title}`,
    `How to play: ${c.howToPlay ?? ''}`,
    `Cast: ${c.sprites.map((s) => `${s.name} (${s.description})`).join('; ')}`,
    `Art and sounds: ${c.assets.map((a) => `${a.kind === 'sound' ? 'sound' : 'picture'} "${a.name}": ${a.request ?? a.description ?? ''}`).join('; ')}`,
    'The code (Amble engine on Phaser 3; each sprite is a class, the stage runs the game):',
    ...c.code.map((x) => `// ---- ${x.targetName}\n${x.source}`),
  ].join('\n\n');
  const content = [{ type: 'text', text: `${text}\n\nScore this game. The picture is the game after about 12 seconds of play by a bot that presses keys at random.` }];
  const jpg = path.join(dir, `${id}.jpg`);
  if (existsSync(jpg)) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${readFileSync(jpg).toString('base64')}` } });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({
        model: judgeModel,
        messages: [
          { role: 'system', content: 'You judge games made by an AI game maker for kids. Be consistent and strict: 5 is an ordinary, working game; 8 is one a child would happily show a friend; 10 is exceptional. Judge only what you see in the code and the picture.' },
          { role: 'user', content },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'score', strict: true, schema: SCHEMA } },
        provider: { require_parameters: true },
      }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) throw new Error(JSON.stringify(json).slice(0, 300));
    const score = JSON.parse(raw);
    writeFileSync(path.join(dir, 'judge.json'), JSON.stringify({ judge: judgeModel, id, usd: json.usage?.cost ?? null, ...score }, null, 2));
    return score;
  }
  throw new Error('rate limited');
}

let spent = 0;
const worker = async () => {
  for (;;) {
    const job = jobs.shift();
    if (!job) return;
    try {
      const s = await judge(job);
      console.log(`${path.relative(root, job.dir)}: overall ${s.overall} (fidelity ${s.fidelity}, scope ${s.scope}, polish ${s.polish}, soundness ${s.soundness})`);
    } catch (err) {
      console.log(`${path.relative(root, job.dir)}: FAILED ${err.message}`);
    }
  }
};
await Promise.all(Array.from({ length: parallel }, worker));
void spent;
