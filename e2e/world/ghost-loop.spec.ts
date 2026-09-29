/**
 * The ghost loop (§2.6): tapping a "just bones" character in the running game pauses it and lifts it onto
 * the Desk; after Bring to life (stubbed here: the drawing is swapped in and the come-alive flight is set,
 * as the Desk does) the world comes back without a restart and the member reports `drawn: true`.
 */
import { expect, test } from '../helpers/app';
import { gameFrame, openWorld, readGame, startGame } from './world';

test.describe('the ghost loop', () => {
  test('tap a ghost → the Desk; Bring to life → drawn in place, no restart', async ({ page }) => {
    const id = await openWorld(page);
    const frame = await gameFrame(page);
    await startGame(page, frame);
    const creates = await readGame(frame, (g) => g.createCount);

    // Where the Moon King's stand-in is, in the game frame; then tap it on the page.
    const box = await readGame(frame, (g) => g.objects().find((o) => o.key === 'moonKing')!);
    const slot = (await page.getByTestId('world-slot').boundingBox())!;
    await page.mouse.click(slot.x + box.x + box.w / 2, slot.y + box.y + box.h / 2);
    await expect(page).toHaveURL(new RegExp(`#/w/${id}/draw/moonKing$`), { timeout: 15_000 });
    await expect(page.getByTestId('screen-draw')).toBeVisible();
    await expect.poll(() => readGame(frame, (g) => g.state)).toBe('paused');

    // What the Desk does on Bring to life: the drawing goes into the running game, the flight is set,
    // and the student comes back to the world.
    await page.evaluate(async (worldId) => {
      const w = window as unknown as {
        __amble: {
          services: { player: { swapArt(a: { key: string; image: Blob }): void } };
          navigate(r: { name: 'world'; id: string }): void;
        };
      };
      const c = new OffscreenCanvas(220, 190);
      const g = c.getContext('2d')!;
      g.fillStyle = '#f2cf5e';
      g.beginPath();
      g.ellipse(110, 110, 100, 78, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = '#221b2e';
      g.stroke();
      const png = await c.convertToBlob({ type: 'image/png' });
      w.__amble.services.player.swapArt({ key: 'moonKing', image: png });
      const { setComeAlive } = await import(/* @vite-ignore */ `${location.origin}/src/state/session.ts`);
      setComeAlive({ key: 'moonKing', artId: 'a_test000001', sticker: URL.createObjectURL(png), from: new DOMRect(300, 200, 200, 180) });
      w.__amble.navigate({ name: 'world', id: worldId });
    }, id);

    await expect(page.getByTestId('screen-world')).toBeVisible();
    await expect.poll(() => readGame(frame, (g) => !!g.find('moonKing')?.drawn), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 15_000 }).toBe('running');
    expect(await readGame(frame, (g) => g.createCount)).toBe(creates);
    expect(await readGame(frame, (g) => g.objects().find((o) => o.key === 'moonKing')?.drawn)).toBe(true);
  });

  test('a needed cast card lifts its member onto the Desk, its picture on the lift card', async ({ page }) => {
    const id = await openWorld(page);
    // What the lift card carries as it grows toward the Desk (it is gone once the Desk is there).
    await page.evaluate(() => {
      const w = window as unknown as { liftArt: string | null };
      w.liftArt = null;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n instanceof HTMLElement && n.classList.contains('flight__lift')) w.liftArt = n.querySelector('svg, img')?.tagName.toLowerCase() ?? 'blank';
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.getByTestId('cast-card-moonKing').click();
    await expect(page).toHaveURL(new RegExp(`#/w/${id}/draw/moonKing$`), { timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { liftArt: string | null }).liftArt)).toBe('svg');
  });
});
