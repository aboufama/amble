/**
 * A world that plays the fixture boss game (src/starters/fixtureGame.ts, the player core's demo game: art
 * keys hero, boss, minion, ground, ledge, shot, orb, bomb; dials jump, orbSpeed, bossHealth), made through
 * the app's own starter catalog and store. The AI fixtures (e2e/fixtures/ai/*.patch) and the module specs
 * that test the pipeline or the code editor use it, so they stay on a known game however the starters
 * change; the journeys and seams play the real starters.
 */
import type { Page } from '@playwright/test';

export const FIXTURE_KEYS = ['hero', 'boss', 'minion', 'ground', 'ledge', 'shot', 'orb', 'bomb'] as const;

/** Stores a new world playing the fixture game and opens it; resolves with its id once its game has loaded. */
export async function openFixtureWorld(page: Page): Promise<string> {
  const id = await page.evaluate(async (keys) => {
    type Amble = {
      services: {
        starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> & { id: string } }> };
        store: { commit(c: unknown): Promise<void> };
      };
      navigate(r: unknown): void;
    };
    const a = (window as unknown as { __amble: Amble }).__amble;
    const url = '/src/starters/fixtureGame.ts';
    const { FIXTURE_GAME } = (await import(/* @vite-ignore */ url)) as { FIXTURE_GAME: string };
    const opened = await a.services.starters.open('moon-king', { withArt: false });
    const world = {
      ...opened.world,
      code: [{ path: 'game.js', source: FIXTURE_GAME, authors: [['starter', FIXTURE_GAME.split('\n').length]], locked: [] }],
      cast: Object.fromEntries(keys.map((key) => [key, { key, art: null, madeBy: null, extra: null, laterUntil: 0 }])),
      dials: {},
      twists: [],
    };
    await a.services.store.commit({ worlds: [world] });
    a.navigate({ name: 'world', id: world.id });
    return world.id;
  }, [...FIXTURE_KEYS]);
  await page.waitForFunction(
    (worldId) => {
      const s = (window as unknown as { __amble: { getState(): { session: { world: { id: string } | null; manifest: { art: unknown[] } | null } } } }).__amble.getState();
      return s.session.world?.id === worldId && s.session.manifest !== null && s.session.manifest.art.length > 0;
    },
    id,
    { timeout: 60_000 },
  );
  return id;
}
