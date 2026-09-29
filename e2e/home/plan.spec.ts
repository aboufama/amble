/**
 * From an idea to a world (§2.5), with `mockAi` behind the test class link: the New world sheet's idea
 * goes to the AI (after the AI explainer, the first time on a device), the plan card comes back,
 * **Build it first** opens the new world in its Warm-up while the build runs in the background, and
 * **Draw {hero} while I build** opens the Desk on the hero. When the plan call fails, the closest starter
 * is offered instead.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { mockAi, type MockAiLog, type MockAiOptions } from '../helpers/mockAi';

const IDEA = 'a snail who rescues her friends from a grumpy salt king';

interface WorldLike {
  origin: { kind: string; planTitle?: string };
  code: Array<{ source: string }>;
  cast: Record<string, unknown>;
  plan: { title: string } | null;
}
interface AmbleLike {
  store: { worlds: { get(id: string): Promise<WorldLike | null> } };
  getState(): { ai: { job: { worldId: string; task: string } | null } };
}

/** Joins the test class; `explainerSeen` skips the AI explainer card. */
async function openWithAi(page: Page, o: MockAiOptions, explainerSeen = true): Promise<MockAiLog> {
  const log = await mockAi(page, o);
  await openAmble(page, { ai: 'mock', ...(explainerSeen ? { prefs: { seen: { aiExplainer: Date.now() } } } : {}) });
  return log;
}

async function sendIdea(page: Page): Promise<void> {
  await gotoRoute(page, '#/new?idea=1');
  await expect(page.getByTestId('screen-new')).toBeVisible();
  const field = page.getByTestId('idea-field');
  await expect(field).toBeVisible();
  await field.fill(IDEA);
  await page.getByTestId('idea-go').click();
}

/** The build streams nothing and waits, so the world stays in its Warm-up for the rest of the test. */
function holdTheBuild(log: MockAiLog): void {
  log.set({ stallAfterChars: 0 });
  log.queue('build-moon-king.patch');
}

async function worldOf(page: Page): Promise<{ id: string; world: WorldLike | null }> {
  const id = /#\/w\/(w_[A-Za-z0-9_-]+)/.exec(new URL(page.url()).hash)?.[1] ?? '';
  const world = await page.evaluate((w) => (window as unknown as { __amble: AmbleLike }).__amble.store.worlds.get(w), id);
  return { id, world };
}

test('an idea becomes a plan card, and Build it first opens the world in its Warm-up', async ({ page }) => {
  const log = await openWithAi(page, { plan: 'plan-snail.json' }, false);
  await sendIdea(page);

  // The first idea on this device waits for the AI explainer; Got it sends it.
  const explainer = page.getByTestId('ai-explainer');
  await expect(explainer).toBeVisible();
  expect(log.ofKind('plan')).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Got it' }).click();

  await expect(page).toHaveURL(/#\/plan$/);
  const card = page.getByTestId('plan-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Shelly's Big Rescue");
  await expect(card).toContainText('The Salt King');
  await expect(page.getByTestId('screen-plan')).toContainText(IDEA);
  expect(log.ofKind('plan')).toHaveLength(1);
  expect(log.ofKind('plan')[0].userText).toContain('salt king');
  holdTheBuild(log);

  await page.getByTestId('plan-build').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  const { id, world } = await worldOf(page);
  expect(world?.origin).toMatchObject({ kind: 'plan', planTitle: "Shelly's Big Rescue" });
  expect(world?.plan?.title).toBe("Shelly's Big Rescue");
  expect(world?.code.map((f) => f.source).join('\n')).toContain('Warm-up');
  expect(Object.keys(world?.cast ?? {})).toEqual(expect.arrayContaining(['hero', 'saltKing']));
  // The build is on its way in the background.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __amble: AmbleLike }).__amble.getState().ai.job)).toMatchObject({ worldId: id, task: 'build' });
  await expect.poll(() => log.tasks('build').length, { timeout: 15_000 }).toBe(1);
});

test('Draw the hero while I build opens the Desk on the hero', async ({ page }) => {
  const log = await openWithAi(page, { plan: 'plan-snail.json' });
  await sendIdea(page);
  await expect(page.getByTestId('plan-card')).toBeVisible();
  holdTheBuild(log);
  await page.getByTestId('plan-draw').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+\/draw\/hero$/);
  await expect(page.getByTestId('screen-draw')).toBeVisible();
});

test('when the plan call fails, the closest starter is offered', async ({ page }) => {
  await openWithAi(page, { plan: { status: 500 } });
  await sendIdea(page);
  const fallback = page.getByTestId('plan-fallback');
  await expect(fallback).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('fallback-start').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  const { world } = await worldOf(page);
  expect(world?.origin.kind).toBe('starter');
});
