/**
 * Accessibility (§3.9, §10.2 `a11y`): axe finds no WCAG 2.1 A/AA problem on any screen or dialog, and the
 * core flow works from the keyboard alone (the Trail → a starter → Change → the boss → a dial by arrows →
 * Bones → a joint by arrows → Done → Look inside → Run it → Hand in), with focus always visible and Esc
 * always a way out of the game.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { classLinkPayload, expect, gotoRoute, openAmble, test, TEST_CLASS } from '../helpers/app';
import { mockAi } from '../helpers/mockAi';
import { gameFrame, openStarter, readGame, worldReady } from './journey';

/** axe's WCAG 2.1 A and AA problems on the page as it is (the game frames are canvases, left out). */
async function axe(page: Page, where: string): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('iframe').analyze();
  return r.violations.map((v) => `${where} → ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

async function screen(page: Page, hash: string): Promise<void> {
  await gotoRoute(page, hash);
  // Let entrances and lazy chunks settle before reading the page.
  await page.waitForTimeout(400);
}

test('every screen and dialog passes axe', async ({ page }) => {
  test.setTimeout(420_000);
  const found: string[] = [];
  await openAmble(page, { clean: true });
  found.push(...(await axe(page, 'First page')));

  for (const hash of ['#/trail', '#/trail/list', '#/trail/lost', '#/new', '#/new?idea=1', '#/draw/new']) {
    await screen(page, hash);
    found.push(...(await axe(page, hash)));
  }

  // A starter world, its modes, sheets and dialogs.
  const id = await openStarter(page, 'moon-king');
  found.push(...(await axe(page, 'world')));
  await page.getByRole('radio', { name: 'Change' }).click();
  await page.getByTestId('tag-moonKing').click();
  await expect(page.getByTestId('thing-card')).toBeVisible();
  found.push(...(await axe(page, 'world, Change, a thing card')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  for (const item of ['World info', 'Sounds', 'Controls', 'Problems']) {
    await page.getByRole('button', { name: 'More for this world' }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    found.push(...(await axe(page, `world, ${item}`)));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page.getByTestId('cast-add').click();
  await expect(page.getByRole('dialog').first()).toBeVisible();
  found.push(...(await axe(page, 'world, Add someone')));
  await page.keyboard.press('Escape');

  for (const hash of [`#/w/${id}/handin`, `#/w/${id}/draw/grumble`, `#/w/${id}/bones/hero`, `#/w/${id}/code`]) {
    await screen(page, hash);
    if (hash.includes('/draw/')) await expect(page.locator('.desk__sheet canvas').first()).toBeVisible();
    if (hash.includes('/code')) await expect(page.locator('.cm-content')).toBeVisible();
    found.push(...(await axe(page, hash)));
  }

  for (const tab of ['link', 'assignments', 'gallery', 'help']) {
    await screen(page, `#/teacher/${tab}`);
    found.push(...(await axe(page, `#/teacher/${tab}`)));
  }
  for (const section of ['ai', 'sound', 'reading', 'drawing', 'keys', 'storage', 'about']) {
    await screen(page, `#/settings/${section}`);
    found.push(...(await axe(page, `#/settings/${section}`)));
  }
  for (const p of ['privacy', 'terms', 'ai', 'it', 'parents', 'accessibility', 'poster', 'sent', 'whatsnew']) {
    await screen(page, `#/${p}`);
    found.push(...(await axe(page, `#/${p}`)));
  }

  // The Join card a class link opens.
  await page.goto(`./#class=${classLinkPayload(TEST_CLASS as unknown as Record<string, unknown>)}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  found.push(...(await axe(page, 'Join card')));
  expect(found).toEqual([]);
});

test('the AI cards pass axe: the explainer, the plan card and the crisis card', async ({ page }) => {
  test.setTimeout(240_000);
  await mockAi(page, { plan: 'plan-snail.json' });
  await openAmble(page, { ai: 'mock', clean: true });
  const found: string[] = [];
  await screen(page, '#/new?idea=1');
  // The explainer opens when the student asks (How wishes work), never on its own.
  await page.getByTestId('how-wishes').click();
  await expect(page.getByTestId('ai-explainer')).toBeVisible();
  found.push(...(await axe(page, 'AI explainer')));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ai-explainer')).toBeHidden();
  await page.getByTestId('idea-field').fill('a snail who rescues her friends from a grumpy salt king');
  await page.getByTestId('idea-go').click();
  await expect(page.getByTestId('plan-card')).toBeVisible();
  found.push(...(await axe(page, 'plan card')));

  await openStarter(page, 'moon-king');
  await page.getByTestId('ai-field').fill('I want to kill myself');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-crisis')).toBeVisible();
  found.push(...(await axe(page, 'crisis card')));
  expect(found).toEqual([]);
});

// ------------------------------------------------------------------ the keyboard-only journey

/** What has focus now: its test id, role, name and whether a focus ring is drawn around it. */
async function focused(page: Page): Promise<{ id: string; role: string; name: string; tag: string; ring: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { id: '', role: '', name: '', tag: 'body', ring: false };
    // A ring on the element, or on a part of it that draws the focus (a sign's frame, a card).
    // (Children count by their outline only: plenty of cards carry a shadow all the time.)
    const outlined = (e: Element) => {
      const s = getComputedStyle(e);
      return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    };
    const own = getComputedStyle(el);
    // A slider draws its ring on its thumb (`.slider__range:focus-visible::-webkit-slider-thumb`), which
    // computed styles don't show.
    const thumb = el instanceof HTMLInputElement && el.type === 'range' && el.classList.contains('slider__range');
    const ring = outlined(el) || (own.boxShadow !== 'none' && own.boxShadow !== '') || thumb || [...el.querySelectorAll('*')].slice(0, 80).some(outlined);
    return { id: el.dataset.testid ?? '', role: el.getAttribute('role') ?? '', name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 60) ?? '', tag: el.tagName.toLowerCase(), ring };
  });
}

/** Presses Tab until focus is on what `match` accepts (at most `max` presses); each stop must show its ring. */
async function tabTo(page: Page, what: string, match: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 40, key = 'Tab'): Promise<void> {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const f = await focused(page);
    seen.push(`${f.tag}${f.id ? `#${f.id}` : ''} "${f.name.slice(0, 40)}"`);
    if (f.tag !== 'body' && f.tag !== 'main' && f.tag !== 'iframe') expect(f.ring, `a focus ring on ${f.tag} "${f.name}" (${what})`).toBe(true);
    if (match(f)) return;
  }
  throw new Error(`${key} never reached ${what}. Focus went: ${seen.join(' → ')}`);
}

test('the core flow works from the keyboard alone, with focus always visible', async ({ page }) => {
  test.setTimeout(300_000);
  await openAmble(page, { clean: true, route: '#/trail' });
  await expect(page.getByTestId('screen-trail')).toBeVisible();

  // The Trail: the signs are one tab stop; the arrows walk them; Enter opens the Moon King starter.
  await tabTo(page, 'a world sign', (f) => f.id === 'trail-sign');
  for (let i = 0; i < 12; i++) {
    if ((await focused(page)).name.includes('Moon King')) break;
    await page.keyboard.press('ArrowRight');
  }
  expect((await focused(page)).name).toContain('Moon King');
  await page.keyboard.press('Enter');
  const worldId = await worldReady(page);

  // "Skip to the game" puts focus on the game; its keys then play it (Space starts, the arrows run).
  await tabTo(page, 'Skip to the game', (f) => f.name === 'Skip to the game', 60, 'Shift+Tab');
  await page.keyboard.press('Enter');
  expect((await focused(page)).id).toBe('world-slot');
  const frame = await gameFrame(page);
  await page.keyboard.press('Space');
  await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 20_000 }).toBe('running');
  const heroX = () => readGame(frame, (g) => (g.find('hero') as { x?: number } | null)?.x ?? 0);
  const x0 = await heroX();
  await page.keyboard.down('ArrowRight');
  await expect.poll(heroX, { timeout: 20_000 }).toBeGreaterThan(x0 + 5);
  await page.keyboard.up('ArrowRight');

  // Tab never enters the game's frame (nothing in it takes focus), so the keyboard is never stuck there.
  // A click can put focus inside it, though, and then Esc gets out.
  await page.locator('iframe.amble-player-frame:not([aria-hidden="true"])').focus();
  expect((await focused(page)).tag).toBe('iframe');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await focused(page)).tag).not.toBe('iframe');

  // Change mode by its key; Tab to the Moon King's tag; Enter opens his card; a dial by arrows.
  await page.locator('body').focus();
  await page.keyboard.press('c');
  await expect(page.getByRole('radio', { name: 'Change' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('tag-moonKing')).toBeVisible();
  await tabTo(page, 'the Moon King', (f) => f.id === 'tag-moonKing', 60);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('thing-card')).toBeVisible();
  // Focus moves into the card.
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.thing-card'))).toBe(true);
  await tabTo(page, 'a dial', (f) => f.role === 'slider' || f.tag === 'input', 10);
  const before = await page.evaluate(() => (document.activeElement as HTMLInputElement).value);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLInputElement).value)).not.toBe(before);

  // Bones from his card; a joint picked up with Enter and moved by the arrows; Done.
  await tabTo(page, 'Bones', (f) => f.id === 'thing-bones' || f.name === 'Bones', 10, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/bones/moonKing$`));
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await tabTo(page, 'a joint', (f) => f.tag !== 'body' && f.name.includes('Arrow keys move it'), 60);
  await page.keyboard.press('Enter');
  await expect(page.locator('.joint--picked')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('bones-status')).toHaveText('You placed these bones');
  await tabTo(page, 'Done', (f) => f.name === 'Done', 60, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  await worldReady(page);

  // Look inside from the ⋯ menu; a number changed; Run it by Ctrl+Enter.
  await tabTo(page, 'the ⋯ menu', (f) => f.name === 'More for this world', 40, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await tabTo(page, 'Look inside', (f) => f.name.startsWith('Look inside'), 12, 'ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/code`));
  await expect(page.locator('.cm-content')).toBeVisible();
  await tabTo(page, 'the code', (f) => f.role === 'textbox' || f.name === '' && f.tag === 'div', 40);
  await page.keyboard.press('Control+f');
  await page.keyboard.type('gravity: 1500');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('1400,');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('run-bar')).toContainText('Your changes are running!');

  // Hand in from the world's ⋯ menu.
  await page.keyboard.press('Escape');
  await gotoRoute(page, `#/w/${worldId}`);
  await worldReady(page);
  await tabTo(page, 'the ⋯ menu', (f) => f.name === 'More for this world', 40, 'Shift+Tab');
  await page.keyboard.press('Enter');
  await tabTo(page, 'Hand in', (f) => f.name.startsWith('Hand in'), 12, 'ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/handin$`));
  await expect(page.getByRole('dialog', { name: /^Hand in your world/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
});
