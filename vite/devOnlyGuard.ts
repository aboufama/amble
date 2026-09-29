/**
 * Fails a production build that carries dev-only code (§10.2): the editor's test hooks (`window.__amble`,
 * the Desk's `window.__ambleDesk`) and the e2e harnesses (src/screens/ai/harness.tsx,
 * src/screens/files/harness/panel.tsx). They live behind `import.meta.env.DEV` or are never imported by
 * the app, so a build that still holds one of them has a wiring mistake. The in-game `window.__ambleGame`
 * is meant to ship (the sandbox has nothing to steal) and is not checked here.
 */
import type { Plugin } from 'vite';

/** What each dev-only piece leaves in a bundle if it gets in. */
export const DEV_ONLY_MARKERS: ReadonlyArray<{ what: string; test: RegExp }> = [
  { what: 'the editor test hook (window.__amble)', test: /\.__amble\s*=/ },
  { what: "the Desk's test hook (window.__ambleDesk)", test: /__ambleDesk/ },
  { what: 'the AI cards harness (src/screens/ai/harness.tsx)', test: /mountAiHarness|ai-harness__/ },
  { what: 'the files harness (src/screens/files/harness/panel.tsx)', test: /__m6\b|m6-dock|m6-scene-/ },
];

/** The dev-only pieces a chunk's code holds. */
export function devOnlyIn(code: string): string[] {
  return DEV_ONLY_MARKERS.filter((m) => m.test.test(code)).map((m) => m.what);
}

export function devOnlyGuard(): Plugin {
  return {
    name: 'amble-dev-only-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const found: string[] = [];
      for (const item of Object.values(bundle)) {
        const code = item.type === 'chunk' ? item.code : typeof item.source === 'string' && /\.m?js$/.test(item.fileName) ? item.source : null;
        if (code === null) continue;
        for (const what of devOnlyIn(code)) found.push(`${item.fileName}: ${what}`);
      }
      if (found.length) this.error(`Dev-only code reached the production build:\n${found.join('\n')}`);
    },
  };
}
