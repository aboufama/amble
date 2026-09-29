/**
 * From an idea to a world (§2.5): the New world sheet's idea goes to the AI, the plan card comes back,
 * **Build it first** opens the new world in its Warm-up while the build runs in the background, and
 * **Draw {hero} while I build** opens the Desk on the hero. When the plan call fails, the closest starter
 * is offered instead.
 *
 * The AI is `mockAi` behind the test class link. Until the AI pipeline (M5) is in this build, the app's
 * AI service is the foundation stub, which never calls out: the spec then answers the same plan through
 * `window.__amble.services.ai`, so the Home side is tested either way.
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { aiFixture, mockAi, type MockAiLog } from '../helpers/mockAi';

const IDEA = 'a snail who rescues her friends from a grumpy salt king';

interface WorldLike {
  origin: { kind: string; planTitle?: string };
  code: Array<{ source: string }>;
  cast: Record<string, unknown>;
  plan: { title: string } | null;
}
interface AmbleLike {
  services: { ai: Record<string, unknown> & { status(): string } };
  store: { worlds: { get(id: string): Promise<WorldLike | null> } };
  getState(): { config: { ai: unknown }; ai: { job: { worldId: string; task: string } | null } };
}

/** True when the app's AI service is the foundation stub (it says 'off' even with a class's AI on). */
async function aiIsStub(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = (window as unknown as { __amble: AmbleLike }).__amble;
    return a.getState().config.ai !== null && a.services.ai.status() === 'off';
  });
}

/** Stands in for the AI pipeline: the plan (or a failed call), and a build that never finishes. */
async function answerInPage(page: Page, reply: { plan: unknown } | { fail: true }): Promise<void> {
  await page.evaluate((r) => {
    const ai = (window as unknown as { __amble: AmbleLike }).__amble.services.ai;
    ai.status = () => 'ready';
    ai.plan = async () => {
      await new Promise((done) => setTimeout(done, 400));
      if ('fail' in r) throw new Error('The class AI did not answer.');
      return { kind: 'plan', plan: r.plan };
    };
    ai.build = () => new Promise(() => undefined);
  }, reply);
}

async function openWithAi(page: Page, plan: Parameters<typeof mockAi>[1]): Promise<{ log: MockAiLog; stub: boolean }> {
  const log = await mockAi(page, plan);
  await openAmble(page, { ai: 'mock', prefs: { seen: { aiExplainer: Date.now() } } });
  const stub = await aiIsStub(page);
  test.info().annotations.push({ type: 'ai', description: stub ? 'foundation stub: plan answered in the page' : 'AI pipeline with mockAi' });
  return { log, stub };
}

async function sendIdea(page: Page): Promise<void> {
  await gotoRoute(page, '#/new?idea=1');
  await expect(page.getByTestId('screen-new')).toBeVisible();
  const field = page.getByTestId('idea-field');
  await expect(field).toBeVisible();
  await field.fill(IDEA);
  await page.getByTestId('idea-go').click();
}

async function worldOf(page: Page): Promise<{ id: string; world: WorldLike | null }> {
  const id = /#\/w\/(w_[A-Za-z0-9_-]+)/.exec(new URL(page.url()).hash)?.[1] ?? '';
  const world = await page.evaluate((w) => (window as unknown as { __amble: AmbleLike }).__amble.store.worlds.get(w), id);
  return { id, world };
}

test('an idea becomes a plan card, and Build it first opens the world in its Warm-up', async ({ page }) => {
  const { log, stub } = await openWithAi(page, { plan: 'plan-snail.json' });
  if (stub) await answerInPage(page, { plan: JSON.parse(aiFixture('plan-snail.json')) });
  await sendIdea(page);

  await expect(page).toHaveURL(/#\/plan$/);
  const card = page.getByTestId('plan-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Shelly's Big Rescue");
  await expect(card).toContainText('The Salt King');
  await expect(page.getByTestId('screen-plan')).toContainText(IDEA);
  if (!stub) {
    expect(log.ofKind('plan')).toHaveLength(1);
    expect(log.ofKind('plan')[0].userText).toContain('salt king');
    // The build streams nothing and waits: the world stays in its Warm-up for this test.
    log.set({ stallAfterChars: 0 });
    log.queue('build-moon-king.patch');
  }

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
});

test('Draw the hero while I build opens the Desk on the hero', async ({ page }) => {
  const { log, stub } = await openWithAi(page, { plan: 'plan-snail.json' });
  if (stub) await answerInPage(page, { plan: JSON.parse(aiFixture('plan-snail.json')) });
  else {
    log.set({ stallAfterChars: 0 });
    log.queue('build-moon-king.patch');
  }
  await sendIdea(page);
  await expect(page.getByTestId('plan-card')).toBeVisible();
  await page.getByTestId('plan-draw').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+\/draw\/hero$/);
  await expect(page.getByTestId('screen-draw')).toBeVisible();
});

test('when the plan call fails, the closest starter is offered', async ({ page }) => {
  const { stub } = await openWithAi(page, { plan: { status: 500 } });
  if (stub) await answerInPage(page, { fail: true });
  await sendIdea(page);
  const fallback = page.getByTestId('plan-fallback');
  await expect(fallback).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('fallback-start').click();
  await expect(page).toHaveURL(/#\/w\/w_[A-Za-z0-9_-]+$/);
  const { world } = await worldOf(page);
  expect(world?.origin.kind).toBe('starter');
});
