/**
 * The starter worlds' integrity (§10.1): every cast member is declared in `static art` and the other way
 * round, every starter validates with 0 errors and 0 warnings and type-checks against the kit, keeps to
 * its size rules, declares its dials, spares and "your turn" member as §9 says, every ArtScript is valid,
 * and every committed drawing (art.json, its files, its rig) is there and parses.
 */
import { describe, expect, it } from 'vitest';
import { validateArtScript } from '../../src/cores/art';
import { kitManifest, sourceFilesOf, validateGame } from '../../src/cores/ai';
import { parseRig } from '../../src/cores/rig';
import { STARTER_IDS, STARTERS } from '../../src/starters/catalog';
import { starterCode } from '../../src/starters/open';
import type { StarterArtJson } from '../../src/starters/types';

// Node's modules, loaded at run time: the project's type-check has DOM types only.
interface NodeFs {
  readFileSync(file: string, enc?: 'utf8'): string;
  existsSync(file: string): boolean;
}
const load = <T>(name: string): Promise<T> => import(/* @vite-ignore */ name) as Promise<T>;
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

/** Every starter's code (its files load on demand, as a lazy chunk in the app). */
const CODE = new Map(await Promise.all(STARTERS.map(async (m) => [m.id, await starterCode(m)] as const)));
const codeOf = (id: string) => CODE.get(id as (typeof STARTERS)[number]['id']) ?? [];

function statics(id: string) {
  const meta = STARTERS.find((s) => s.id === id);
  if (!meta) throw new Error(id);
  const r = validateGame(sourceFilesOf(codeOf(id)), { manifest: kitManifest(), fix: false });
  return { meta, r, art: r.statics.art as Record<string, { spare?: boolean; kind?: string }>, dials: r.statics.dials as Record<string, { for?: string; label: string }> };
}

describe('the starter catalog', () => {
  it('has the five starters in Trail order, then the hidden Parade', () => {
    expect(STARTERS.map((s) => s.id)).toEqual([...STARTER_IDS, 'parade']);
  });

  for (const meta of STARTERS) {
    describe(meta.id, () => {
      const { r, art, dials } = statics(meta.id);

      it('validates with 0 errors and 0 warnings', () => {
        expect([...r.errors, ...r.warnings].map((i) => `${i.file}:${i.line} ${i.rule}: ${i.message}`)).toEqual([]);
      });

      it('declares every cast member in static art, and nothing else', () => {
        expect(Object.keys(art).sort()).toEqual(meta.cast.map((c) => c.key).sort());
        for (const c of meta.cast) expect(art[c.key].kind, c.key).toBe(c.kind);
      });

      it('keeps to the size rules: 1 to 3 files, game.js at most 150 lines, helpers at most 120', () => {
        const files = codeOf(meta.id);
        expect(files.length).toBeGreaterThanOrEqual(1);
        expect(files.length).toBeLessThanOrEqual(3);
        expect(files[files.length - 1].path).toBe('game.js');
        for (const f of files) expect(f.source.split('\n').length, f.path).toBeLessThanOrEqual(f.path === 'game.js' ? 150 : 120);
      });

      it('marks its spares, and uses them only once drawn', () => {
        const code = codeOf(meta.id).map((f) => f.source).join('\n');
        for (const key of meta.spare) {
          expect(art[key].spare, key).toBe(true);
          expect(code, key).toContain(`hasArt('${key}')`);
        }
        for (const c of meta.cast) expect(c.state === 'spare', c.key).toBe(meta.spare.includes(c.key));
      });

      if (meta.id !== 'parade') {
        it('exposes 4 to 6 dials, each for a declared member when it has one', () => {
          const list = Object.values(dials);
          expect(list.length).toBeGreaterThanOrEqual(4);
          expect(list.length).toBeLessThanOrEqual(6);
          for (const d of list) {
            expect(d.label.length).toBeLessThanOrEqual(24);
            if (d.for) expect(Object.keys(art)).toContain(d.for);
          }
        });

        it('leaves its "your turn" member as just bones', () => {
          expect(meta.yourTurn).not.toBeNull();
          const c = meta.cast.find((m) => m.key === meta.yourTurn);
          expect(c?.state).toBe('yourTurn');
          expect(meta.scripts[meta.yourTurn as string]).toBeUndefined();
        });
      }

      it('draws its drawn members with valid ArtScripts', async () => {
        for (const c of meta.cast.filter((m) => m.state === 'drawn')) {
          const load = meta.scripts[c.key];
          expect(load, c.key).toBeTypeOf('function');
          const script = await (load as () => Promise<Parameters<typeof validateArtScript>[0]>)();
          expect(validateArtScript(script), c.key).toEqual([]);
          expect(script.name).toBe(c.script);
          expect(script.kind).toBe(c.kind);
        }
      });

      it('has the committed files of every drawn member, with a rig that parses for characters', async () => {
        const fs = await load<NodeFs>('node:fs');
        for (const c of meta.cast.filter((m) => m.state === 'drawn')) {
          const dir = `${root}/public/starters/${meta.id}/art/${c.key}`;
          const json = JSON.parse(fs.readFileSync(`${dir}/art.json`, 'utf8')) as StarterArtJson;
          expect(json.key).toBe(c.key);
          expect(json.name).toBe(c.name);
          for (const path of Object.values(json.files)) expect(fs.existsSync(`${dir}/${path}`), `${c.key}/${path}`).toBe(true);
          const refs = [json.doc, ...json.cels, json.export.flat, json.export.sticker, json.export.thumb, ...Object.values(json.export.parts).map((p) => p.blob)];
          for (const ref of refs) expect(json.files[ref], `${c.key}: ${ref}`).toBeTruthy();
          if (c.kind === 'character') {
            const rig = parseRig(json.rigData);
            expect(rig.made, c.key).toBe('hand');
            expect(rig.artHash.startsWith(`${json.export.w}x${json.export.h}:`)).toBe(true);
            for (const p of rig.parts ?? []) expect(json.export.parts[p.layer ?? ''], `${c.key} ${p.name}`).toBeTruthy();
            const committed = parseRig(JSON.parse(fs.readFileSync(`${root}/src/starters/${meta.id}/art/${c.key}.rig.json`, 'utf8')));
            expect(committed).toEqual(rig);
          }
        }
        if (meta.id !== 'parade') expect(fs.existsSync(`${root}/public/starters/${meta.id}/sign.png`)).toBe(true);
      });
    });
  }
});

describe('the starters type-check against the kit (tsc --checkJs with amble-kit.d.ts)', () => {
  it('has no type errors in any starter', async () => {
    const { typecheck } = await load<{ typecheck(id: string): string[] }>(`${root}/tools/starters/lib/typecheck.mjs`);
    const out = STARTERS.flatMap((s) => typecheck(s.id).map((line) => `${s.id}: ${line}`));
    expect(out).toEqual([]);
  }, 120_000);
});
