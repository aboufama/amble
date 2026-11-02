import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileProject } from '../src/compiler/compile';
import { DEFAULT_SETTINGS } from '../src/compiler/openai';
import { block, newProject, workspace } from '../src/project/defaults';

afterEach(() => vi.unstubAllGlobals());

const sse = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;

describe('compiled assets', () => {
  it('keeps a costume and a sound that share a name apart', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).endsWith('/api/config')) return new Response('{}', { status: 404 });
        const body = JSON.parse(String(init.body));
        const name = body.response_format?.json_schema?.name;
        const prompt = String(body.messages[1].content);
        const reply =
          name === 'amble_pieces'
            ? {
                pieces: [...prompt.matchAll(/^- (p\d+):/gm)].map((m) => ({ id: m[1], code: '' })),
                sprites: [],
                assets: [
                  { target: 'Amble', kind: 'costume', name: 'zap', description: 'a lightning bolt', width: 40, height: 40, reuse: false },
                  { target: 'Amble', kind: 'sound', name: 'zap', description: 'an electric zap', width: 0, height: 0, reuse: false },
                ],
                warnings: [],
                questions: [],
              }
            : name === 'svg_art'
              ? { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 2L8 22h10l-4 16 16-22H20z" fill="#ffd84d"/></svg>' }
              : { segments: [{ wave: 'square', startFreq: 900, endFreq: 200, duration: 0.2, startVolume: 0.6, endVolume: 0 }] };
        return new Response(sse(JSON.stringify(reply)), { status: 200 });
      }),
    );
    const p = newProject();
    p.sprites[0].blocks = workspace([block('ev_start'), block('ga_do', { ACTION: 'zap!' })]);
    const game = await compileProject(p, { settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-test' } });
    const zaps = game.assets.filter((a) => a.name === 'zap');
    expect(zaps.map((a) => a.kind).sort()).toEqual(['image', 'sound']);
    expect(new Set(zaps.map((a) => a.id)).size).toBe(2);
  });
});
