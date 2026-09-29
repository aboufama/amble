/** Helpers for the world screen's specs: open a starter as a world, reach its game frame, read the game. */
import type { Frame, Page } from '@playwright/test';
import { expect, openAmble, type OpenAmbleOptions } from '../helpers/app';

export interface GameHook {
  state: string;
  createCount: number;
  errors: unknown[];
  swaps: number;
  game: unknown;
  find(key: string): { drawn?: boolean } | null;
  objects(): Array<{ id: number; key: string | null; x: number; y: number; w: number; h: number; drawn: boolean }>;
  dial(name: string): number | undefined;
  twists(): string[];
}

export type GameWin = Window & { __ambleGame: GameHook };

interface AmbleWin {
  __amble: {
    getState(): { session: Record<string, unknown> & { world: { id: string; title: string; steps: Array<{ text: string; kind: string }> } | null; mode: string } };
    services: { player: { player: { iframe: HTMLIFrameElement | null } | null } };
  };
}

/**
 * Opens Amble (with `o`, for example a class link so wishes are on), then the Moon King seed as the
 * student's world (nothing drawn yet: every member is just bones); waits for its first frame. Returns the
 * world id.
 */
export async function openWorld(page: Page, o: OpenAmbleOptions = {}): Promise<string> {
  await openAmble(page, o);
  await page.evaluate(async () => {
    const a = (window as unknown as { __amble: { services: { starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: { id: string } }> }; store: { commit(c: unknown): Promise<void> } }; navigate(r: unknown): void } }).__amble;
    const { world } = await a.services.starters.open('moon-king', { withArt: false });
    await a.services.store.commit({ worlds: [world] });
    a.navigate({ name: 'world', id: world.id });
  });
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect(page.getByTestId('player-layer')).toHaveAttribute('data-first-frame', /^[1-9]\d*$/, { timeout: 45_000 });
  await expect(page.getByTestId('world-loading')).toHaveCount(0);
  return new URL(page.url()).hash.replace('#/w/', '');
}

/** The visible game's frame. */
export async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as AmbleWin).__amble.services.player.player?.iframe ?? null);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('No game frame.');
  await frame.waitForFunction(() => !!(window as unknown as GameWin).__ambleGame?.game);
  return frame;
}

export function readGame<T>(frame: Frame, fn: (g: GameHook) => T): Promise<T> {
  return frame.evaluate(`(${fn.toString()})(window.__ambleGame)`) as Promise<T>;
}

export function session<T>(page: Page, fn: (s: ReturnType<AmbleWin['__amble']['getState']>['session']) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__amble.getState().session)`) as Promise<T>;
}

/** Starts the game from its title card (Space on the page goes to the game). */
export async function startGame(page: Page, frame: Frame): Promise<void> {
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 20_000 }).toBe('running');
}
