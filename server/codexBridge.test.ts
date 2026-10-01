import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { codexPrompt, execArgs, isAllowedHost, isSameOrigin, parseAuth, readCodexEvent } from './codexBridge';

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
