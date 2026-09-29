/**
 * The build's image-generation guard (vite/imageGenGuard.ts, §5.11): a build fails when any file it writes
 * names an image-generation endpoint, tool or model, and passes for what Amble really sends (vision input
 * for Magic bones, chat completions, moderation).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { imageGenerationIn, imageGenerationInDir, imageGenGuard } from '../../vite/imageGenGuard';

const dirs: string[] = [];
function outDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'amble-imagegen-'));
  dirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, 'dist', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('imageGenerationIn', () => {
  it('finds image-generation endpoints, tools and models as a bundle holds them', () => {
    const hits = [
      'fetch(t.baseUrl+"/images/generations",{method:"POST"})',
      'const u=`${base}/v1/images/edits`',
      '"/openai/deployments/pics/images/variations?api-version=2024-10-21"',
      'tools:[{type:"image_generation"}]',
      'model:"gemini-2.0-flash-preview-image-generation"',
      'model:"gpt-image-1"',
      "model:'dall-e-3'",
      '"models/imagen-3.0-generate-002:predict"',
      '"imagegeneration@006"',
      '"https://api.stability.ai/v2beta/stable-image/generate/core"',
      '"/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image"',
    ];
    for (const code of hits) expect(imageGenerationIn(code), code).not.toEqual([]);
  });

  it('leaves alone what Amble really sends and shows', () => {
    const fine = [
      'fetch(t.baseUrl+"/chat/completions",{method:"POST"})',
      'aiFetch(t,"/moderations",{method:"POST"})',
      '{type:"image_url",image_url:{url:e,detail:"low"}}',
      'caps:{...c.caps,images:!1}',
      'const imageGeneration=null',
      '"The AI helper never draws: every picture is yours."',
      'this.load.image("sky","images/sky.png")',
    ];
    for (const code of fine) expect(imageGenerationIn(code), code).toEqual([]);
  });
});

describe('the build check', () => {
  it('lists every written file that names one', async () => {
    const root = outDir({ 'index.html': '<!doctype html><title>Amble</title>', 'assets/index-abc.js': 'fetch(b+"/chat/completions")', 'assets/art-def.js': 'fetch(b+"/images/generations")', 'sw.js': 'self.addEventListener("fetch",f)' });
    expect(await imageGenerationInDir(join(root, 'dist'))).toEqual(['assets/art-def.js: an image endpoint (/images/generations, /images/edits or /images/variations)']);
  });

  it('fails the build when the output holds one, after the other plugins wrote their files', async () => {
    const plugin = imageGenGuard();
    const hook = plugin.closeBundle as { order: string; handler(this: unknown): Promise<void> };
    expect(plugin.apply).toBe('build');
    expect(hook.order).toBe('post');
    const configure = plugin.configResolved as (c: unknown) => void;

    configure({ root: outDir({ 'index.html': '<!doctype html>', 'starters/moon-king/art.json': '{"name":"Moon King"}' }), build: { outDir: 'dist', ssr: false } });
    await expect(hook.handler.call({})).resolves.toBeUndefined();

    configure({ root: outDir({ 'index.html': '<!doctype html>', 'assets/x.js': 'body.model="dall-e-3"' }), build: { outDir: 'dist', ssr: false } });
    await expect(hook.handler.call({})).rejects.toThrow(/assets\/x\.js: an image model/);
  });

  it('is part of the production build', () => {
    const config = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toMatch(/plugins:\s*\[[\s\S]*imageGenGuard\(\)[\s\S]*\]/);
  });
});
