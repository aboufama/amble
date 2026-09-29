// A scripted OpenAI-compatible endpoint for the AI harness, served by its Vite dev server.
// Paths: /mock/<scenario>[-<run>]/v1/(chat/completions|moderations). The harness page runs on
// 127.0.0.1 and calls localhost, so every request is cross-origin and goes through CORS.

const PLAN = {
  title: 'Moon King',
  pitch: 'Pop grumpy moon rocks with a bubble wand, then face the Moon King.',
  cast: [{ key: 'hero', ask: 'Draw Rae, a space kid' }, { key: 'boss', ask: 'Draw the Moon King, a giant boss' }],
  safety: { changed: false, note: '' },
};

const GAME = [
  'class Game extends Amble.Scene {',
  "  static config = { title: 'MOON KING', physics: 'arcade', gravity: 1500 };",
  "  static art = { hero: { kind: 'character', rig: 'biped', ask: 'Draw Rae' }, boss: { kind: 'character', rig: 'blob', ask: 'Draw the Moon King' } };",
  '  create() {',
  "    this.hero = this.spawnHero(140, 420, 'hero').platformer({ jump: this.dials.jump });",
  "    this.boss = this.spawnEnemy(720, 190, 'boss', { boss: true, hp: 150 });",
  "    this.ui.bossBar(this.boss, 'THE MOON KING');",
  '  }',
  '}',
];

// Cut off inside the second file, as a token limit would.
const PATCH = ['@@amble-patch 1', '@@summary Rae meets the Moon King.', '@@play Arrows move, Space jumps.', '@@safety ok', '@@file game.js create', ...GAME, '@@file boss.js create', 'class BossMoves {', '  slam() {'].join('\n');

const runs = new Map();
const log = [];

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

async function stream(res, text, { pieces = 4, gapMs = 20, finish = 'stop' } = {}) {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.flushHeaders();
  res.write(chunk({ role: 'assistant', content: '' }));
  const size = Math.ceil(text.length / pieces);
  for (let i = 0; i < text.length; i += size) {
    if (res.destroyed) return;
    await delay(gapMs);
    res.write(chunk({ content: text.slice(i, i + size) }));
  }
  res.write(chunk({}, finish));
  res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 90, total_tokens: 1290, prompt_tokens_details: { cached_tokens: 1024 } } })}\n\n`);
  res.end('data: [DONE]\n\n');
}

function hasImages(body) {
  const content = body?.messages?.[1]?.content;
  return Array.isArray(content) && content.some((p) => p.type === 'image_url');
}

async function chat(scenario, run, body, res) {
  const key = `${scenario}-${run}`;
  const n = (runs.get(key) ?? 0) + 1;
  runs.set(key, n);
  switch (scenario) {
    case 'plain':
      return json(res, 200, { choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(PLAN) }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 60 } });
    case 'retry':
      if (n === 1) return json(res, 429, { error: { message: 'Rate limit reached for this class', code: 'rate_limit_exceeded' } }, { 'retry-after-ms': '300' });
      return stream(res, JSON.stringify(PLAN));
    case 'images':
      if (hasImages(body)) return json(res, 400, { error: { message: 'Invalid content type. image_url is only supported by certain models.', param: 'messages' } });
      return stream(res, JSON.stringify(PLAN));
    case 'stall':
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.flushHeaders();
      res.write(chunk({ content: '{"title": "Moo' }));
      return undefined;
    case 'slow':
      return stream(res, JSON.stringify(PLAN), { pieces: 30, gapMs: 200 });
    case 'html':
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html');
      return res.end("<html><body><h1>Blocked</h1><p>This site is blocked by your school's web filter.</p></body></html>");
    case 'auth':
      return json(res, 401, { error: { message: 'Invalid or expired class code', code: 'invalid_class_code' } });
    case 'strict':
      if (body?.response_format?.type === 'json_schema') return json(res, 400, { error: { message: "response_format 'json_schema' is not supported by this server", param: 'response_format' } });
      return json(res, 200, { choices: [{ index: 0, message: { content: `Here is the plan:\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`` }, finish_reason: 'stop' }] });
    case 'patch':
      return stream(res, PATCH, { pieces: 12, gapMs: 15, finish: 'length' });
    default:
      return stream(res, JSON.stringify(PLAN));
  }
}

function moderations(scenario, body, res) {
  if (scenario === 'nomod') return json(res, 404, { error: { message: 'Not found' } });
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  return json(res, 200, {
    results: inputs.map((text) => {
      const mean = /meanie/i.test(String(text));
      return { flagged: mean, categories: { harassment: mean, violence: false } };
    }),
  });
}

export function mockAi() {
  return {
    name: 'amble-ai-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/mock/_log') return json(res, 200, log.slice(-100));
        const m = /^\/mock\/([a-z]+)(?:-(\w+))?\/v1\/(chat\/completions|moderations)$/.exec(url.pathname);
        if (!m) return next();
        const [, scenario, run = '', endpoint] = m;
        if (scenario !== 'nocors') {
          res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
          res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
          res.setHeader('access-control-allow-headers', 'content-type, authorization, x-amble-class');
          res.setHeader('access-control-expose-headers', 'retry-after, retry-after-ms');
          res.setHeader('access-control-max-age', '600');
        }
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }
        readBody(req).then((body) => {
          log.push({ path: url.pathname, origin: req.headers.origin ?? '', classCode: req.headers['x-amble-class'] ?? '', authorization: req.headers.authorization ? 'present' : '', model: body.model, store: body.store, stream: body.stream, safetyIdentifier: body.safety_identifier ?? '' });
          if (endpoint === 'moderations') return moderations(scenario, body, res);
          return chat(scenario, run, body, res);
        });
        return undefined;
      });
    },
  };
}
