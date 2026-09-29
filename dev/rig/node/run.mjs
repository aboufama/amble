// Bundles and runs a Node dev tool from this folder. Usage: node dev/rig/node/run.mjs <tool> [args...]
// Tools: debug [sample...] (auto-rig + debug sheets), perf (rig and bind timings).
// Output goes to $RIG_OUT (default: ./out).
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '.dist');
mkdirSync(dist, { recursive: true });
const [tool = 'debug', ...args] = process.argv.slice(2);
const entry = join(dist, `${tool}-entry.ts`);
const fn = `run${tool[0].toUpperCase()}${tool.slice(1)}`;
writeFileSync(entry, `import { ${fn} } from '../${tool}';\n${fn}(${JSON.stringify(args)});\n`);
const out = join(dist, `${tool}.mjs`);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning', target: 'node20' });
await import(pathToFileURL(out).href);
