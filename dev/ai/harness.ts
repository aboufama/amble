// Runs src/ai in a real browser against dev/ai/mock.mjs and reports each check.
// dev/ai/check.mjs opens this page with a class link in the fragment and reads window.__aiHarness.
import {
  applyPatch,
  chatJson,
  chatText,
  checkStudentText,
  clearClassLink,
  describeAiSource,
  isAiError,
  moderate,
  parsePatch,
  pendingClassLink,
  readManagedConfig,
  resolveAiConfig,
  s,
  safetyIdentifier,
  saveClassLink,
  screenOutput,
  stripClassLinkFromUrl,
  transportFor,
  validateGame,
  type AiError,
  type ChatStatus,
  type ContentPart,
  type Transport,
} from '../../src/ai';
import boss from '../../tests/ai/fixtures/games/boss.js?raw';
import chaos from '../../tests/ai/fixtures/games/chaos.js?raw';
import runner from '../../tests/ai/fixtures/games/runner.js?raw';
import { PROBE_MANIFEST } from '../../tests/ai/fixtures/probeManifest';

interface Result {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}

interface LogEntry {
  path: string;
  classCode: string;
  authorization: string;
  store: unknown;
  stream: unknown;
  safetyIdentifier: string;
}

declare global {
  interface Window {
    __aiHarness?: { done: boolean; results: Result[] };
  }
}

const API = 'http://localhost:5214/mock';
const Plan = s.object({
  title: s.string({ max: 28 }),
  pitch: s.string(),
  cast: s.array(s.object({ key: s.string(), ask: s.string() })),
  safety: s.object({ changed: s.boolean(), note: s.string() }),
});
const REQ = { model: 'amble-default', system: 'You plan games for Amble.', user: 'a space kid who pops grumpy moon rocks', schema: Plan, schemaName: 'amble_plan' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function endpoint(scenario: string, over: Partial<Transport> = {}): Transport {
  const run = Math.random().toString(36).slice(2, 8);
  return { baseUrl: `${API}/${scenario}-${run}/v1`, headers: { 'X-Amble-Class': 'MAPLE-7Q2K' }, via: 'endpoint', auth: 'class-code', caps: {}, host: 'localhost:5214', ...over };
}

const results: Result[] = [];
const rows = document.getElementById('rows') as HTMLTableSectionElement;

function render(r: Result): void {
  const tr = document.createElement('tr');
  const cells: Array<[string, string]> = [
    [r.ok ? 'PASS' : 'FAIL', `status ${r.ok ? 'ok' : 'bad'}`],
    [r.name, ''],
    [`${r.ms.toFixed(0)} ms`, 'ms'],
    [r.detail, 'detail'],
  ];
  for (const [text, cls] of cells) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    tr.append(td);
  }
  rows.append(tr);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = performance.now();
  let result: Result;
  try {
    result = { name, ok: true, ms: performance.now() - t0, detail: await fn() };
    result.ms = performance.now() - t0;
  } catch (err) {
    const detail = isAiError(err) ? `AiError ${err.kind}: ${err.message} (${err.detail})` : err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    result = { name, ok: false, ms: performance.now() - t0, detail };
  }
  results.push(result);
  render(result);
}

async function failsWith(p: Promise<unknown>, kind: AiError['kind']): Promise<AiError> {
  try {
    await p;
  } catch (err) {
    assert(isAiError(err), `expected an AiError, got ${String(err)}`);
    assert(err.kind === kind, `expected ${kind}, got ${err.kind} (${err.detail})`);
    return err;
  }
  throw new Error(`expected ${kind}, but the call succeeded`);
}

async function lastRequest(): Promise<LogEntry | undefined> {
  const log = (await (await fetch('/mock/_log')).json()) as LogEntry[];
  return log.at(-1);
}

function timeEach(runs: number, fn: () => void): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t0) / runs;
}

async function run(): Promise<void> {
  await check('Class link from the address bar: saved, stripped, resolved and used', async () => {
    const pending = pendingClassLink(location);
    assert(pending?.ok, `no usable class link: ${JSON.stringify(pending)}`);
    saveClassLink(pending.link, localStorage);
    stripClassLinkFromUrl(window);
    assert(!location.hash.includes('class='), 'the fragment is still in the address bar');
    const config = await resolveAiConfig({ env: {}, dev: false, managed: null });
    assert(config.source === 'class-link' && config.enabled, `resolved ${config.source}, off: ${config.offReason}`);
    const t = transportFor(config);
    assert(t, 'no transport');
    const statuses: ChatStatus[] = [];
    const r = await chatJson(t, { ...REQ, model: config.model, onStatus: (st) => statuses.push(st) });
    const sent = await lastRequest();
    assert(sent?.classCode === 'MAPLE-7Q2K' && sent.authorization === '', 'class code header missing, or a key was sent');
    assert(sent.store === false && sent.stream === true, 'store:false / stream:true not sent');
    assert(/^amble_[0-9a-f]{40}$/.test(sent.safetyIdentifier), `safety identifier: ${sent.safetyIdentifier}`);
    clearClassLink(localStorage);
    const writing = statuses.filter((st) => st.phase === 'writing').length;
    return `${describeAiSource(config).title} · "${r.value.title}" · ${writing} progress updates · ${r.usage?.totalTokens} tokens (${r.usage?.cachedTokens} cached)`;
  });

  await check('No ChromeOS managed configuration outside a managed device', async () => {
    const managed = await readManagedConfig();
    assert(managed === null, 'expected null');
    return 'navigator.managed absent: falls through to the next source';
  });

  await check('A proxy that ignores stream: true and answers plain JSON', async () => {
    const r = await chatJson(endpoint('plain'), REQ);
    return `"${r.value.title}", ${r.usage?.totalTokens} tokens`;
  });

  await check('429 with Retry-After, then success', async () => {
    const statuses: ChatStatus[] = [];
    const t0 = performance.now();
    const r = await chatJson(endpoint('retry'), { ...REQ, onStatus: (st) => statuses.push(st) });
    const retry = statuses.find((st) => st.phase === 'retrying');
    assert(retry && retry.phase === 'retrying' && retry.reason === 'rate-limited', 'no rate-limited retry reported');
    assert(performance.now() - t0 >= 250, 'did not wait');
    return `waited ${retry.delayMs} ms, then "${r.value.title}"`;
  });

  await check('A model that rejects pictures: retried without them', async () => {
    const user: ContentPart[] = [
      { type: 'text', text: 'Find the joints in this outline.' },
      { type: 'image_url', image_url: { url: PNG, detail: 'low' } },
    ];
    const r = await chatJson(endpoint('images'), { ...REQ, user });
    assert(r.imagesDropped, 'imagesDropped should be true');
    return 'imagesDropped: true, remembered for this model';
  });

  await check('A stream that stalls mid-reply times out', async () => {
    const t0 = performance.now();
    await failsWith(chatJson(endpoint('stall'), { ...REQ, stallMs: 400 }), 'timeout');
    const ms = performance.now() - t0;
    assert(ms < 3000, `took ${ms.toFixed(0)} ms`);
    return `timeout after ${ms.toFixed(0)} ms (stallMs 400)`;
  });

  await check("A filter's HTML block page", async () => {
    const err = await failsWith(chatJson(endpoint('html'), REQ), 'blocked-by-filter');
    return err.message;
  });

  await check('An endpoint that blocks CORS', async () => {
    const err = await failsWith(chatJson(endpoint('nocors'), { ...REQ, retries: 0 }), 'blocked-by-filter');
    return err.message;
  });

  await check('Cancel mid-stream with an AbortSignal', async () => {
    const ctl = new AbortController();
    const t0 = performance.now();
    await failsWith(chatJson(endpoint('slow'), { ...REQ, signal: ctl.signal, onStatus: (st) => st.phase === 'writing' && ctl.abort() }), 'cancelled');
    const ms = performance.now() - t0;
    assert(ms < 1500, `took ${ms.toFixed(0)} ms`);
    return `cancelled after ${ms.toFixed(0)} ms`;
  });

  await check('An expired class code', async () => {
    const err = await failsWith(chatJson(endpoint('auth'), REQ), 'auth');
    return err.message;
  });

  await check('No strict schema on the server: json_object fallback, fenced JSON parsed', async () => {
    const r = await chatJson(endpoint('strict'), REQ);
    assert(r.format === 'json_object', `format ${r.format}`);
    return `format ${r.format}, "${r.value.title}"`;
  });

  await check('A streamed AMBLE PATCH cut off by the token limit', async () => {
    const r = await chatText(endpoint('patch'), { model: 'amble-default', system: 'You write games.', user: 'a boss fight' });
    assert(r.truncated && r.finishReason === 'length', 'expected a truncated reply');
    const patch = parsePatch(r.text);
    assert(patch.ops.length === 1 && patch.truncatedIn === 'boss.js', `ops ${patch.ops.length}, cut in ${patch.truncatedIn}`);
    const applied = applyPatch([], patch.ops);
    const checked = validateGame(applied.files, { manifest: PROBE_MANIFEST });
    assert(checked.ok, checked.errors.map((e) => e.message).join('; '));
    return `kept game.js, cut in ${patch.truncatedIn}; valid, ${checked.fixes.length} auto-fix (${checked.fixes.map((f) => f.rule).join(', ')})`;
  });

  await check('Moderation endpoint: flags, and a missing /moderations is remembered', async () => {
    const m = await moderate(endpoint('sse'), ['you meanie', 'hello']);
    assert(m.checked && m.results[0].flagged && !m.results[1].flagged, JSON.stringify(m));
    const out = await screenOutput(['YOU WIN!', 'you meanie'], { band: 'middle', moderation: 'endpoint', transport: endpoint('sse') });
    assert(!out.ok && out.flagged[0]?.index === 1, JSON.stringify(out));
    const none = endpoint('nomod');
    const first = await moderate(none, ['x']);
    const second = await moderate(none, ['x']);
    assert(!first.checked && !second.checked, 'expected unsupported');
    return `flagged ${m.results[0].categories.join(', ')}; game text flagged at index 1; no /moderations remembered`;
  });

  await check('Safety identifier from Web Crypto', async () => {
    const a = await safetyIdentifier({ salt: location.origin, storage: localStorage });
    const b = await safetyIdentifier({ salt: location.origin, storage: localStorage });
    assert(a && a === b && /^amble_[0-9a-f]{40}$/.test(a), `got ${a}`);
    return `${a.slice(0, 14)}… (stable today)`;
  });

  await check('Local filter: crisis, refusal, allow, and its speed', async () => {
    assert(checkStudentText('i want to kill myself', 'middle').kind === 'crisis', 'crisis');
    assert(checkStudentText('punch my teacher', 'middle').kind === 'refuse', 'refuse');
    assert(checkStudentText('kill the slime and drop a bomb on the boss', 'middle').kind === 'allow', 'allow');
    const text = 'make a platformer where a space kid pops grumpy moon rocks with a bubble wand, then fights the Moon King in three phases with lasers';
    const ms = timeEach(300, () => checkStudentText(text, 'middle'));
    return `${(ms * 1000).toFixed(0)} µs per request`;
  });

  await check('Validator on the three demo games', async () => {
    const games = [boss, chaos, runner];
    for (const g of games) {
      const r = validateGame([{ path: 'game.js', content: g }], { manifest: PROBE_MANIFEST });
      assert(r.ok && r.warnings.length === 0, r.errors.map((e) => e.message).join('; '));
    }
    const ms = games.map((g) => timeEach(40, () => validateGame([{ path: 'game.js', content: g }], { manifest: PROBE_MANIFEST })));
    const lines = games.map((g) => g.split('\n').length);
    return ms.map((m, i) => `${lines[i]} lines: ${m.toFixed(2)} ms`).join(' · ');
  });

  await check('Patch parse and apply speed', async () => {
    const edits = Array.from({ length: 20 }, (_, i) => `@@find\n    this.v${i} = ${i};\n@@replace\n    this.v${i} = ${i * 2};\n@@done`).join('\n');
    const file = `class Helper {\n  constructor() {\n${Array.from({ length: 20 }, (_, i) => `    this.v${i} = ${i};`).join('\n')}\n  }\n}\n`;
    const text = `@@amble-patch 1\n@@summary x\n@@file helper.js edit\n${edits}\n@@file game.js create\n${boss}\n@@end\n`;
    const ms = timeEach(100, () => applyPatch([{ path: 'helper.js', content: file }], parsePatch(text).ops));
    const r = applyPatch([{ path: 'helper.js', content: file }], parsePatch(text).ops);
    assert(r.failures.length === 0 && r.files.length === 2, 'apply failed');
    return `20 edits + a 100-line file: ${ms.toFixed(2)} ms`;
  });

  const passed = results.filter((r) => r.ok).length;
  const summary = document.getElementById('summary') as HTMLParagraphElement;
  summary.textContent = `${passed} of ${results.length} checks passed`;
  summary.style.color = passed === results.length ? 'var(--ok)' : 'var(--bad)';
  window.__aiHarness = { done: true, results };
}

void run();
