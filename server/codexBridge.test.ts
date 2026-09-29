import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { CodexRunEvent } from '../src/ai/codexTypes';
import {
  codexPrompt,
  decodeImageDataUrl,
  execArgs,
  isAllowedHost,
  isSameOrigin,
  parseAuth,
  readCodexEvent,
  readRunImages,
  runCodexRequest,
} from './codexBridge';

/** A real 1x1 PNG. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Codex bridge', () => {
  it('reads how Codex is signed in', () => {
    expect(parseAuth('Logged in using ChatGPT')).toBe('chatgpt');
    expect(parseAuth('Logged in using an API key - sk-proj-***ABCD')).toBe('apikey');
    expect(parseAuth('Not logged in')).toBe('none');
    expect(parseAuth('')).toBe('none');
  });

  it('runs Codex read-only, throwaway, with a schema, and the prompt on stdin', () => {
    const args = execArgs({ cwd: '/tmp/x/work', schemaFile: '/tmp/x/schema.json', model: 'gpt-6-astra', reasoningEffort: 'low' });
    expect(args[0]).toBe('exec');
    expect(args).toEqual(expect.arrayContaining(['--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check']));
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('--cd') + 1]).toBe('/tmp/x/work');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-6-astra');
    expect(args[args.indexOf('--output-schema') + 1]).toBe('/tmp/x/schema.json');
    expect(args).toContain('model_reasoning_effort=low');
    expect(args).toContain('web_search=disabled');
    expect(args[args.length - 1]).toBe('-');
  });

  it('frames the request so Codex answers with JSON only', () => {
    const prompt = codexPrompt({ system: 'SYSTEM', user: 'USER' });
    expect(prompt.indexOf('SYSTEM')).toBeLessThan(prompt.indexOf('USER'));
    expect(prompt).toMatch(/only the JSON object/);
  });

  it('turns Codex events into progress, the answer, or a failure', () => {
    expect(readCodexEvent('{"type":"turn.started"}')).toEqual({ type: 'progress', phase: 'thinking' });
    expect(readCodexEvent('{"type":"item.started","item":{"type":"command_execution"}}')).toEqual({ type: 'progress', phase: 'working' });
    expect(readCodexEvent('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"a\\":1}"}}')).toEqual({ type: 'message', text: '{"a":1}' });
    expect(readCodexEvent('{"type":"turn.failed","error":{"message":"usage limit reached"}}')).toEqual({ type: 'error', message: 'usage limit reached' });
    // Codex reports retries it recovers from as "error" events; they must not fail the request.
    expect(readCodexEvent('{"type":"error","message":"Reconnecting... 2/5"}')).toEqual({ type: 'note', message: 'Reconnecting... 2/5' });
    expect(readCodexEvent('{"type":"thread.started","thread_id":"t"}')).toBeNull();
    expect(readCodexEvent('not json')).toBeNull();
  });

  it("only takes requests from Amble's own page", () => {
    const req = (headers: Record<string, string>, method = 'POST') => ({ method, headers: { host: 'localhost:5173', ...headers } }) as unknown as IncomingMessage;
    const ok = (r: IncomingMessage) => isSameOrigin(r, []);
    expect(ok(req({ 'content-type': 'application/json', origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(ok(req({}, 'GET'))).toBe(true);
    expect(ok(req({ 'content-type': 'application/json', origin: 'https://evil.example' }))).toBe(false);
    expect(ok(req({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(ok(req({ 'content-type': 'text/plain' }))).toBe(false);
    expect(ok(req({ 'sec-fetch-site': 'same-site' }, 'GET'))).toBe(false);
    // DNS rebinding: evil.example resolves to 127.0.0.1, so origin and host match but the host isn't allowed.
    expect(ok(req({ host: 'evil.example:5173', origin: 'http://evil.example:5173', 'content-type': 'application/json' }))).toBe(false);
  });

  it("repeats Vite's host check", () => {
    expect(isAllowedHost('localhost:5173', [])).toBe(true);
    expect(isAllowedHost('app.localhost', [])).toBe(true);
    expect(isAllowedHost('192.168.1.20:5173', [])).toBe(true);
    expect(isAllowedHost('[::1]:5173', [])).toBe(true);
    expect(isAllowedHost('evil.example:5173', [])).toBe(false);
    expect(isAllowedHost('box-5173.app.github.dev', ['.app.github.dev'])).toBe(true);
    expect(isAllowedHost('anything.example', true)).toBe(true);
  });
});

describe('Codex bridge pictures', () => {
  it('attaches each picture with its own --image flag, before --sandbox and never before the stdin marker', () => {
    const args = execArgs({ cwd: '/tmp/x/work', schemaFile: '/tmp/x/schema.json', model: 'gpt-6-astra', reasoningEffort: 'low', images: ['/tmp/x/image-1.png', '/tmp/x/image-2.jpg'] });
    const flags = args.flatMap((a, i) => (a === '--image' ? [i] : []));
    expect(flags).toHaveLength(2);
    expect(args[flags[0] + 1]).toBe('/tmp/x/image-1.png');
    expect(args[flags[1] + 1]).toBe('/tmp/x/image-2.jpg');
    expect(Math.max(...flags)).toBeLessThan(args.indexOf('--sandbox'));
    expect(args[args.length - 1]).toBe('-');
    expect(args[args.length - 2]).not.toMatch(/image/);
    // Without pictures the arguments are exactly what they were.
    expect(execArgs({ cwd: 'c', schemaFile: 's', model: 'm', reasoningEffort: 'low', images: [] })).toEqual(execArgs({ cwd: 'c', schemaFile: 's', model: 'm', reasoningEffort: 'low' }));
  });

  it('accepts only real pictures as data URLs', () => {
    const png = decodeImageDataUrl(PNG);
    expect(png?.ext).toBe('png');
    expect(png?.bytes.readUInt32BE(0)).toBe(0x89504e47);
    expect(decodeImageDataUrl(PNG.replace('image/png', 'image/jpeg'))).toBeNull(); // the bytes aren't a JPEG
    expect(decodeImageDataUrl('data:text/html;base64,PGgxPmhpPC9oMT4=')).toBeNull();
    expect(decodeImageDataUrl('https://example.com/cat.png')).toBeNull();
    expect(decodeImageDataUrl('data:image/png;base64,')).toBeNull();
    expect(decodeImageDataUrl(42)).toBeNull();
    const huge = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024, 1).toString('base64')}`;
    expect(decodeImageDataUrl(huge)).toBeNull();
  });

  it('checks the pictures of a run request as a whole', () => {
    expect(readRunImages(undefined)).toEqual([]);
    expect(readRunImages([PNG, PNG])).toEqual([PNG, PNG]);
    expect(readRunImages([PNG, 'data:image/png;base64,AAAA'])).toBeNull();
    expect(readRunImages([PNG, PNG, PNG, PNG, PNG])).toBeNull();
    expect(readRunImages('nope')).toBeNull();
  });

  it('forwards the token usage Codex reports', () => {
    expect(readCodexEvent('{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":45}}')).toEqual({
      type: 'usage',
      usage: { inputTokens: 120, cachedInputTokens: 20, outputTokens: 45 },
    });
    expect(readCodexEvent('{"type":"turn.completed"}')).toBeNull();
  });
});

describe('Codex bridge run', () => {
  const saved = process.env.CODEX_PATH;
  const dirs: string[] = [];
  afterEach(() => {
    if (saved === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = saved;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A stand-in for the Codex CLI: reports its arguments, the pictures it was given and the prompt. */
  function fakeCodex(): void {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'amble-fake-codex-'));
    dirs.push(dir);
    const file = path.join(dir, 'codex.cjs');
    writeFileSync(
      file,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  const images = args.flatMap((a, i) => (a === '--image' ? [args[i + 1]] : [])).map((f) => ({
    file: f, exists: fs.existsSync(f), head: fs.readFileSync(f).subarray(0, 4).toString('hex'),
  }));
  const say = (ev) => process.stdout.write(JSON.stringify(ev) + '\\n');
  say({ type: 'turn.started' });
  say({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ args, images, prompt }) } });
  say({ type: 'turn.completed', usage: { input_tokens: 9, cached_input_tokens: 0, output_tokens: 3 } });
});
`,
    );
    chmodSync(file, 0o755);
    process.env.CODEX_PATH = file;
  }

  it('writes the pictures to temporary files, passes them to Codex, and removes them afterwards', async () => {
    fakeCodex();
    const events: CodexRunEvent[] = [];
    await runCodexRequest(
      { system: 'SYSTEM', user: 'USER', schema: { type: 'object' }, model: 'gpt-6-astra', reasoningEffort: 'low', images: [PNG, 'data:image/png;base64,AAAA'] },
      (ev) => events.push(ev),
      new AbortController().signal,
    );
    expect(events.map((e) => e.type)).toEqual(['progress', 'usage', 'result']);
    const result = events.find((e) => e.type === 'result');
    const seen = JSON.parse(result?.type === 'result' ? result.text : '{}') as { args: string[]; images: Array<{ file: string; exists: boolean; head: string }>; prompt: string };
    // The broken second picture was dropped; the good one reached Codex as a real PNG file.
    expect(seen.images).toHaveLength(1);
    expect(seen.images[0]).toMatchObject({ exists: true, head: '89504e47' });
    expect(seen.args.indexOf('--image')).toBeLessThan(seen.args.indexOf('--sandbox'));
    expect(seen.args[seen.args.length - 1]).toBe('-');
    expect(seen.prompt).toContain('SYSTEM');
    // The temporary folder, pictures included, is gone.
    expect(existsSync(seen.images[0].file)).toBe(false);
    expect(existsSync(path.dirname(seen.images[0].file))).toBe(false);
  });

  it('reports a missing Codex install instead of failing silently', async () => {
    process.env.CODEX_PATH = path.join(os.tmpdir(), 'amble-no-such-codex');
    const events: CodexRunEvent[] = [];
    await runCodexRequest({ system: 's', user: 'u', schema: {}, model: 'm', reasoningEffort: 'low' }, (ev) => events.push(ev), new AbortController().signal);
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/isn't installed/) }]);
  });
});
