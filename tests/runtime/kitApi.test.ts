import { describe, expect, it } from 'vitest';
import dts from '../../src/play/kit/amble-kit.d.ts?raw';
import { FIXTURES } from '../../src/runtime/fixtures/index';
import { KIT_API, KIT_REFERENCE, type KitNamespace } from '../../src/play/kit/manifest';

// Node's modules, loaded at run time: the project's type-check has DOM types only.
interface NodeFs {
  mkdtempSync(prefix: string): string;
  writeFileSync(file: string, text: string): void;
  rmSync(dir: string, o: { recursive: boolean; force: boolean }): void;
}
interface NodeChildProcess {
  execFileSync(cmd: string, args: string[], o: { encoding: 'utf8'; stdio: 'pipe' }): string;
}
interface NodeOs {
  tmpdir(): string;
}
const load = <T>(name: string): Promise<T> => import(/* @vite-ignore */ name) as Promise<T>;

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

/** Member names declared in a class or interface body of the d.ts (4-space members, top level of the body). */
function declared(head: RegExp): string[] {
  const start = dts.search(head);
  expect(start, String(head)).toBeGreaterThan(-1);
  const lines = dts.slice(start).split('\n').slice(1);
  const names = new Set<string>();
  for (const line of lines) {
    if (/^ {2}\}/.test(line)) break;
    if (/^ {4}static /.test(line)) continue;
    const m = /^ {4}(?:readonly )?(\w+)\??[<(:]/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

const NS_INTERFACES: Record<KitNamespace, RegExp> = {
  fx: /interface Fx \{/,
  ui: /interface Ui \{/,
  controls: /interface Controls \{/,
  music: /interface Music \{/,
  combo: /interface Combo \{/,
  pattern: /interface Pattern \{/,
  twists: /interface Twists \{/,
};

describe('KIT_REFERENCE', () => {
  it('lists the scene and every namespace with signatures and docs', () => {
    const names = KIT_REFERENCE.namespaces.map((n) => n.name);
    expect(names).toEqual(['', ...Object.keys(KIT_API.namespaces)]);
    const scene = KIT_REFERENCE.namespaces[0];
    expect(scene.members.map((m) => m.name)).toEqual(KIT_API.docs.scene.map((m) => m.name));
    expect(scene.members.find((m) => m.name === 'fx')?.kind).toBe('namespace');
    expect(scene.members.find((m) => m.name === 'spawnHero')?.kind).toBe('method');
    for (const ns of KIT_REFERENCE.namespaces.slice(1)) {
      expect(ns.members.map((m) => m.name), ns.name).toEqual(KIT_API.namespaces[ns.name as KitNamespace]);
      expect(ns.doc, ns.name).not.toBe('');
      for (const m of ns.members) expect(m.signature && m.doc, `${ns.name}.${m.name}`).toBeTruthy();
    }
  });
});

describe('KIT_API and amble-kit.d.ts', () => {
  it('declare the same scene members', () => {
    const inDts = declared(/class Scene extends Phaser\.Scene \{/);
    const inApi = KIT_API.docs.scene.map((m) => m.name);
    expect(inApi.filter((n) => !inDts.includes(n))).toEqual([]);
    expect(inDts.filter((n) => !inApi.includes(n))).toEqual([]);
  });

  it('declare the same namespace members', () => {
    for (const [ns, head] of Object.entries(NS_INTERFACES) as Array<[KitNamespace, RegExp]>) {
      const inDts = declared(head);
      const inApi = KIT_API.namespaces[ns];
      expect(inApi.filter((n) => !inDts.includes(n)), ns).toEqual([]);
      expect(inDts.filter((n) => !inApi.includes(n)), ns).toEqual([]);
    }
  });

  it('only map synonyms to real members', () => {
    const scene = new Set(KIT_API.sceneMethods);
    for (const [alias, real] of Object.entries(KIT_API.synonyms)) {
      expect(scene.has(real), `${alias} -> ${real}`).toBe(true);
      expect(scene.has(alias), `${alias} shadows a real member`).toBe(false);
    }
    for (const [ns, map] of Object.entries(KIT_API.namespaceSynonyms) as Array<[KitNamespace, Record<string, string>]>) {
      for (const real of Object.values(map)) expect(KIT_API.namespaces[ns]).toContain(real);
    }
    expect(KIT_API.namespaceSynonyms.fx.screenShake).toBe('shake');
    expect(KIT_API.synonyms.spawnPlayer).toBe('spawnHero');
  });

  it('lists namespace members as ns.member scene entries', () => {
    expect(KIT_API.sceneMethods).toContain('fx.shake');
    expect(KIT_API.sceneMethods).toContain('add');
    expect(KIT_API.sceneMethods).toContain('spawnHero');
  });

  it('type-checks the test games against the declaration (checkJs)', async () => {
    const fs = await load<NodeFs>('node:fs');
    const cp = await load<NodeChildProcess>('node:child_process');
    const os = await load<NodeOs>('node:os');
    const dir = fs.mkdtempSync(`${os.tmpdir()}/amble-kit-dts-`);
    try {
      const phaser = `${root}/node_modules/phaser/types/phaser.d.ts`;
      // As a script (.ts), so the declaration itself is checked too (skipLibCheck skips .d.ts files).
      fs.writeFileSync(`${dir}/amble-kit.ts`, dts.replace('/// <reference types="phaser" />', `/// <reference path=${JSON.stringify(phaser)} />`));
      const games = ['boss', 'chaos', 'runner', 'strobe'] as const;
      // `export {}` makes each game its own module, so every file can have its own `class Game`.
      for (const g of games) fs.writeFileSync(`${dir}/${g}.js`, `${FIXTURES[g]}\nexport {};\n`);
      fs.writeFileSync(
        `${dir}/tsconfig.json`,
        JSON.stringify({
          compilerOptions: { target: 'ES2022', lib: ['ES2023', 'DOM'], module: 'ESNext', moduleResolution: 'bundler', allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: true, types: [] },
          files: ['amble-kit.ts', ...games.map((g) => `${g}.js`)],
        }),
      );
      let out = '';
      try {
        cp.execFileSync(`${root}/node_modules/.bin/tsc`, ['-p', `${dir}/tsconfig.json`], { encoding: 'utf8', stdio: 'pipe' });
      } catch (err) {
        out = String((err as { stdout?: string }).stdout ?? err);
      }
      expect(out).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
