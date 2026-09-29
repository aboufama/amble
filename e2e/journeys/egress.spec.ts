/**
 * Egress and the sandbox (§1.5, §6.2, §10.2 `egress-sandbox`). A whole session (the First page, a starter,
 * an AI change, the Desk, Bones, Look inside, Settings, the Teacher desk, Share as a web page) talks only
 * to the app and the class's AI service, and the game frames make no request at all. A game that tries to
 * reach the network (fetch, WebRTC, a popup, navigating away) is blocked or reported, its localStorage is
 * a shim that lands in the world, a navigation rebuilds the frame with the message, and the editor lives on.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { AI_ORIGIN, mockAi } from '../helpers/mockAi';
import { deskReady, drawOnBoard, escapeGame, frameRequests, gameSource, jumpPatch, openStarter, outsideRequests, settle, storedWorld, worldReady } from './journey';

test('a whole session talks only to the app and the class AI service', async ({ page, guards, baseURL }) => {
  test.setTimeout(300_000);
  const ai = await mockAi(page, { chunkDelayMs: 20 });
  // Share as a web page saves through the save picker (a file in the origin-private file system here).
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async (o: { suggestedName?: string }) =>
      (await navigator.storage.getDirectory()).getFileHandle(o?.suggestedName ?? 'untitled', { create: true });
  });
  await openAmble(page, { ai: 'mock', clean: true, prefs: { seen: { aiExplainer: Date.now() } } });
  await gotoRoute(page, '#/first');
  await expect(page.getByTestId('screen-first')).toBeVisible();

  // A starter with all its drawings, and an AI change in its Ask card.
  const worldId = await openStarter(page, 'moon-king');
  ai.queue({ text: jumpPatch(await gameSource(page)) });
  await page.getByTestId('ai-field').fill('let me jump three times');
  await page.getByTestId('ai-send').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __amble: { getState(): { ai: { job: unknown; lastOutcome: { kind: string } | null } } } }).__amble.getState().ai.lastOutcome?.kind ?? null), { timeout: 120_000 })
    .not.toBeNull();

  // The Desk, Bones and Look inside.
  const yourTurn = await page.evaluate(() => (window as unknown as { __amble: { getState(): { session: { cast: Array<{ key: string; status: string }> } } } }).__amble.getState().session.cast.find((m) => m.status === 'needed')?.key ?? 'hero');
  await gotoRoute(page, `#/w/${worldId}/draw/${yourTurn}`);
  await deskReady(page);
  await drawOnBoard(page, [
    [300, 300],
    [420, 360],
    [520, 300],
  ]);
  await settle(page);
  await gotoRoute(page, `#/w/${worldId}/bones/hero`);
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await gotoRoute(page, `#/w/${worldId}/code`);
  await expect(page.locator('.cm-content')).toBeVisible();

  // Settings, the in-app pages and the Teacher desk.
  for (const route of ['#/settings', '#/settings/ai', '#/privacy', '#/sent', '#/teacher/link', '#/teacher/gallery']) {
    await gotoRoute(page, route);
    await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
  }

  // Share as a web page: the whole game in one file, made on this Chromebook.
  await gotoRoute(page, `#/w/${worldId}`);
  await worldReady(page);
  await page.getByRole('button', { name: 'More for this world' }).click();
  await page.getByRole('menuitem', { name: 'Share as a web page' }).click();
  await expect(page.getByText(/^Saved .+\(web page\)\.html\. It opens in any browser\.$/)).toBeVisible({ timeout: 60_000 });
  const shared = await page.evaluate(async () => {
    const dir = await navigator.storage.getDirectory();
    for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
      if (name.endsWith('.html')) {
        const text = await (await handle.getFile()).text();
        return { name, bytes: text.length, csp: /http-equiv="Content-Security-Policy"/i.test(text), remote: (text.match(/\b(?:src|href)=["']https?:\/\//gi) ?? []).length };
      }
    }
    return null;
  });
  expect(shared).toMatchObject({ csp: true, remote: 0 });
  expect(shared!.bytes).toBeGreaterThan(100_000);

  // Only the app and ai.test were ever contacted, and no game frame asked for anything.
  const origin = new URL(baseURL!).origin;
  expect(outsideRequests(guards.egress, origin).filter((r) => !r.includes(`${AI_ORIGIN}/`))).toEqual([]);
  expect(frameRequests(guards.egress)).toEqual([]);
  expect(ai.requests.length).toBeGreaterThan(0);
});

test('a game cannot reach the network or leave its frame, and the editor lives on', async ({ page, guards }) => {
  test.setTimeout(180_000);
  await openAmble(page, { clean: true });
  // The dev server has no editor CSP (the build's frame-src 'self' is what stops a frame leaving for
  // another site: journeys/prod checks that), so here the game leaves for a page that needs no network.
  const to = 'about:blank';
  const worldId = await page.evaluate(async (code) => {
    const a = (window as unknown as { __amble: { services: { starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> & { id: string } }> }; store: { commit(c: unknown): Promise<void> } }; navigate(r: unknown): void } }).__amble;
    const { world } = await a.services.starters.open('moon-king', { withArt: false });
    const w = { ...world, title: 'Escape', code: [{ path: 'game.js', source: code, authors: [['student', code.split('\n').length]], locked: [] }], cast: { hero: { key: 'hero', art: null, madeBy: null, extra: null, laterUntil: 0 } } };
    await a.services.store.commit({ worlds: [w] });
    a.navigate({ name: 'world', id: w.id });
    return w.id;
  }, escapeGame(to));
  const navigated = page.waitForFunction(() => (window as unknown as { __amble: { getState(): { session: { stopped: string | null } } } }).__amble.getState().session.stopped !== null, null, { timeout: 60_000 });
  await worldReady(page);

  // Each way out was blocked inside the frame, and localStorage was the shim, saved with the world.
  await expect.poll(async () => (await storedWorld(page, worldId))?.gameStorage?.tried ?? '', { timeout: 30_000 }).toBe('fetch blocked,popup blocked,rtc gone');
  expect((await storedWorld(page, worldId))?.gameStorage?.kept).toBe('yes');

  // Leaving its page is caught: the frame is rebuilt with the message, and the editor is still here.
  await navigated;
  await expect(page.getByText("Games can't open web pages or use the internet, so Amble restarted it.").or(page.getByTestId('world-stopped'))).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#/w/${worldId}`);
  await page.getByRole('radio', { name: 'Change' }).click();
  await expect(page.getByRole('radio', { name: 'Change' })).toHaveAttribute('aria-checked', 'true');
  expect(guards.egress.requests.filter((r) => r.url.includes('evil.test'))).toEqual([]);
});
