/**
 * What the e2e/ai specs share: a starter world opened in the app, the AI cards' harness mounted over it
 * (src/screens/ai/harness.tsx, loaded from the dev server), and reads of the app's state and store.
 */
import { expect, type Page } from '@playwright/test';

/* The page's test hook, loosely typed: these helpers only read and call it. */
export type AmbleWindow = {
  __amble: {
    services: Record<string, any>;
    getState(): any;
    setState(fn: (s: any) => void): void;
    navigate(route: unknown): void;
  };
};

/** Opens a new world from a starter (as a seed, no drawings) and waits until its game has loaded. */
export async function openStarterWorld(page: Page, starter = 'moon-king'): Promise<string> {
  const id = await page.evaluate(async (starterId) => {
    const a = (window as unknown as AmbleWindow).__amble;
    const opened = await a.services.starters.open(starterId, { withArt: false });
    await a.services.store.commit({ worlds: [opened.world] });
    a.navigate({ name: 'world', id: opened.world.id });
    return opened.world.id as string;
  }, starter);
  await page.waitForFunction(
    (worldId) => {
      const s = (window as unknown as AmbleWindow).__amble.getState();
      return s.session.world?.id === worldId && s.session.manifest !== null && s.session.manifest.art.length > 0;
    },
    id,
    { timeout: 60_000 },
  );
  return id;
}

/** Mounts the AI cards over the page: the Ask card, the steer toast and the build pill, or What Amble sends. */
export async function mountHarness(page: Page, view: 'ask' | 'sent' = 'ask'): Promise<void> {
  await page.evaluate(async (v) => {
    const url = '/src/screens/ai/harness.tsx';
    const harness = await import(/* @vite-ignore */ url);
    harness.mountAiHarness({ view: v });
  }, view);
  await expect(page.getByTestId(view === 'sent' ? 'ai-sent' : 'ai-ask')).toBeVisible();
}

/**
 * Pauses the visible game (and waits until it says so). Specs that jump Playwright's clock minutes ahead
 * call it first: the player would read the jump as a frozen game and stop it.
 */
export async function pauseGame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const host = (window as unknown as AmbleWindow).__amble.services.player;
        const off = host.on('state', (m: { state: string }) => {
          if (m.state !== 'paused') return;
          off();
          resolve();
        });
        host.pause();
        setTimeout(resolve, 3000);
      }),
  );
}

/** Marks the AI explainer as seen on this device (most specs are not about it). */
export async function skipExplainer(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as AmbleWindow).__amble.setState((s) => {
      s.prefs.seen.aiExplainer = Date.now();
    });
  });
}

/** Types into the Ask field and presses ★ Ask. */
export async function ask(page: Page, words: string): Promise<void> {
  await page.getByTestId('ai-field').fill(words);
  await page.getByTestId('ai-send').click();
}

/** The Ask card's state (`data-state`). */
export function askState(page: Page) {
  return page.getByTestId('ai-ask');
}

/** The stored world (IndexedDB), as the app would open it next time. */
export async function storedWorld(page: Page, id: string): Promise<any> {
  return page.evaluate((worldId) => (window as unknown as AmbleWindow).__amble.services.store.worlds.get(worldId), id);
}

/** The ai slice's last outcome kind for a world, or null. */
export async function lastOutcome(page: Page, id: string): Promise<string | null> {
  return page.evaluate((worldId) => {
    const s = (window as unknown as AmbleWindow).__amble.getState().ai;
    return s.outcomeFor?.worldId === worldId ? (s.lastOutcome?.kind ?? null) : null;
  }, id);
}

/** Waits until the world's job has ended with an outcome, and returns its kind. */
export async function outcomeOf(page: Page, id: string, timeout = 90_000): Promise<string> {
  await page.waitForFunction(
    (worldId) => {
      const s = (window as unknown as AmbleWindow).__amble.getState().ai;
      return s.job?.worldId !== worldId && s.outcomeFor?.worldId === worldId && s.lastOutcome !== null;
    },
    id,
    { timeout },
  );
  return (await lastOutcome(page, id)) ?? '';
}

/** The text of the world's footsteps, oldest first. */
export async function stepTexts(page: Page, id: string): Promise<string[]> {
  const w = await storedWorld(page, id);
  return (w?.steps ?? []).map((s: { text: string }) => s.text);
}
