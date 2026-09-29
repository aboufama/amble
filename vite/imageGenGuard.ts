/**
 * Fails a production build that could ask an AI service for a picture (§5.11: the AI never draws, so no
 * image-generation endpoint exists anywhere in Amble). Once the build is written, every file in the output
 * folder is read (the page, each chunk and asset, the game player, the public files and the service worker)
 * and searched for the endpoints and model names of the image-generation APIs.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/** What an image-generation call leaves in a bundle: its endpoint path, its tool or its model's name. */
export const IMAGE_GENERATION_MARKERS: ReadonlyArray<{ what: string; test: RegExp }> = [
  { what: 'an image endpoint (/images/generations, /images/edits or /images/variations)', test: /\/images\/(?:generations|edits|variations)\b/i },
  { what: 'an image-generation tool or model (image_generation, image-generation)', test: /\bimages?[-_]generations?\b|\bimagegeneration@/i },
  { what: 'an image model (gpt-image, dall-e, imagen)', test: /\b(?:gpt-image-\d|dall-e-\d|imagen-\d)/i },
  { what: "Stability AI's image generation (stable-image/generate, text-to-image)", test: /\/stable-image\/generate\b|\/text-to-image\b/i },
];

/** The image-generation markers in one file's text. */
export function imageGenerationIn(text: string): string[] {
  return IMAGE_GENERATION_MARKERS.filter((m) => m.test.test(text)).map((m) => m.what);
}

async function filesIn(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesIn(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Every file under `dir` that holds a marker, as "path: what" (paths relative to `dir`). */
export async function imageGenerationInDir(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of await filesIn(dir)) {
    const text = (await readFile(file)).toString('latin1');
    for (const what of imageGenerationIn(text)) found.push(`${path.relative(dir, file).split(path.sep).join('/')}: ${what}`);
  }
  return found;
}

export function imageGenGuard(): Plugin {
  let config: ResolvedConfig | null = null;
  return {
    name: 'amble-image-generation-guard',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle: {
      // After every other plugin has written its files (the service worker is written in closeBundle too).
      order: 'post',
      async handler() {
        if (!config || config.build.ssr) return;
        const outDir = path.resolve(config.root, config.build.outDir);
        const found = await imageGenerationInDir(outDir);
        if (found.length) throw new Error(`An image-generation endpoint reached the build (the AI never draws in Amble, §5.11):\n${found.join('\n')}`);
      },
    },
  };
}
