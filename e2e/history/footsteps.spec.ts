/**
 * Footsteps (§2.9, §8.5 M9), on the Footsteps harness (the panel in the notebook's place over a world with
 * fifteen seeded steps; the world screen hosts the same panel once M2 lands): Go back restores code,
 * drawings and dials and appends a step; See what changed shows the diff; the list works by keyboard.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/app';

const HARNESS = '/tests/history/harness/index.html';

interface LoadSeen {
  files: string;
  art: string[];
  dials: Record<string, number>;
}

interface Harness {
  worldId: string;
  getState(): { session: { world: { code: Array<{ source: string }>; dials: Record<string, number>; cast: Record<string, { art: string | null }>; steps: Array<{ text: string; kind: string }> } | null } };
  services: {
    store: { worlds: { get(id: string): Promise<{ steps: Array<{ kind: string }>; dials: Record<string, number> } | null> } };
    player: { load(init: unknown): Promise<unknown> };
  };
}

/** Records what the running game is asked to load (files, drawings, dials). */
async function spyOnLoads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __harness: Harness; __loads: LoadSeen[] };
    const player = w.__harness.services.player;
    const load = player.load.bind(player);
    w.__loads = [];
    player.load = (init: unknown) => {
      const i = init as { files: Array<{ source: string }>; art: Array<{ key: string }>; dials: Record<string, number> };
      w.__loads.push({ files: i.files.map((f) => f.source).join('\n'), art: i.art.map((a) => a.key), dials: i.dials });
      return load(init);
    };
  });
}

const lastLoad = (page: Page) => page.evaluate(() => (window as unknown as { __loads: LoadSeen[] }).__loads.at(-1) ?? null);

async function openHarness(page: Page): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => Boolean((window as unknown as { __harness?: unknown }).__harness), null, { timeout: 30_000 });
  await expect(page.locator('.footsteps .step').first()).toBeVisible();
}

function world(page: Page) {
  return page.evaluate(() => {
    const w = (window as unknown as { __harness: Harness }).__harness.getState().session.world!;
    return { source: w.code[0].source, dials: w.dials, moonKing: w.cast.boss?.art ?? null, steps: w.steps.map((s) => s.text) };
  });
}

test('Go back restores code, drawings and dials, and appends a step', async ({ page }) => {
  await openHarness(page);
  const steps = page.locator('.footsteps__trail > .step');
  await expect(steps).toHaveCount(15);
  await expect(steps.first()).toContainText('You drew the Moon King');
  await expect(steps.first()).toHaveClass(/step--now/);

  await spyOnLoads(page);
  const before = await world(page);
  expect(before.moonKing).not.toBeNull();
  expect(before.dials).toMatchObject({ jump: 820, orbSpeed: 200 });
  expect(before.source).toContain("fan: { time: 1800, next: 'spiral'");

  const target = steps.filter({ hasText: 'You turned Orb speed down to 200.' });
  await target.hover();
  await target.getByRole('button', { name: 'Go back to this step' }).click();

  await expect(steps).toHaveCount(16);
  await expect(steps.first()).toContainText("You went back to 'You turned Orb speed down to 200'");
  await expect(steps.first()).toHaveClass(/step--now/);
  const after = await world(page);
  expect(after.dials).toMatchObject({ jump: 800, orbSpeed: 200 });
  expect(after.moonKing).toBeNull();
  expect(after.source).toContain('m.chase(this.player, 150);');
  expect(after.source).toContain("fan: { time: 2100, next: 'ring'");
  expect(after.source).toContain('jumps: 3');
  // Nothing was deleted: every earlier step is still listed.
  expect(after.steps.slice(0, before.steps.length)).toEqual(before.steps);
  // The running world restarted with that step's code, drawings and dials.
  await expect.poll(async () => (await lastLoad(page))?.files ?? '').toContain('m.chase(this.player, 150);');
  const loaded = await lastLoad(page);
  expect(loaded?.art).toEqual(['hero']);
  expect(loaded?.dials).toMatchObject({ jump: 800, orbSpeed: 200 });
  const saved = await page.evaluate(async () => {
    const h = (window as unknown as { __harness: Harness }).__harness;
    return h.services.store.worlds.get(h.worldId);
  });
  expect(saved?.steps.map((s) => s.kind).at(-1)).toBe('goback');
  expect(saved?.dials).toMatchObject({ jump: 800 });

  // Going back is itself undoable: back to the Moon King drawing.
  const drew = steps.filter({ hasText: 'You drew the Moon King' });
  await drew.hover();
  await drew.getByRole('button', { name: 'Go back to this step' }).click();
  await expect(steps).toHaveCount(17);
  const again = await world(page);
  expect(again.moonKing).toBe(before.moonKing);
  expect(again.dials).toMatchObject({ jump: 820 });
  await expect.poll(async () => (await lastLoad(page))?.art ?? []).toEqual(['hero', 'boss']);
});

test('See what changed shows the wish, the diff and the drawing', async ({ page }) => {
  await openHarness(page);
  const ai = page.locator('.footsteps__trail > .step').filter({ hasText: 'Amble made the Moon King throw orbs' });
  await expect(ai).toContainText("You wished: 'make him attack in circles'");
  await expect(ai).toContainText('tested');
  await expect(ai).not.toContainText('AI');
  await ai.getByRole('button', { name: 'See what changed' }).click();

  const sheet = page.getByRole('dialog', { name: 'What changed' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Amble made the Moon King throw orbs in rings, then in fans.');
  await expect(sheet).toContainText("You wished: 'make him attack in circles'");
  await expect(sheet).toContainText('Your wish ·');
  await expect(sheet).not.toContainText('AI');
  await expect(sheet.locator('.diff-file__name')).toHaveText('game.js');
  await expect(sheet.locator('.diff-line--del').first()).toContainText("fan: { time: 2100, next: 'ring'");
  await expect(sheet.locator('.diff-line--add').first()).toContainText("fan: { time: 1800, next: 'spiral'");
  await expect(sheet.locator('.diff-line--add .diff-line__mark').first()).toHaveText('1800');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // A drawing step shows the drawing before and after.
  const drew = page.locator('.footsteps__trail > .step').filter({ hasText: 'You drew the Moon King' });
  await drew.hover();
  await drew.getByRole('button', { name: 'See what changed' }).click();
  await expect(sheet.locator('.diff-art')).toContainText('The Moon King');
  await expect(sheet.locator('.diff-art__side')).toHaveCount(2);
  await expect(sheet.getByRole('img', { name: "The Moon King's drawing" })).toBeVisible();
});

test('Footsteps work from the keyboard', async ({ page }) => {
  await openHarness(page);
  const steps = page.locator('.footsteps__trail > .step');
  await steps.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(steps.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(steps.last()).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(steps.nth(2)).toBeFocused();
  // Tab reaches the focused step's own buttons (and only that step's).
  await page.keyboard.press('Tab');
  await expect(steps.nth(2).getByRole('button', { name: 'Go back to this step' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(steps).toHaveCount(16);
  await expect(steps.first()).toContainText('You went back to');
});
