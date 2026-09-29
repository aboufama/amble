/**
 * Drawing on the bones (§2.10, §7.3): the student picks each step by tapping (it never moves on by
 * itself), strokes land on the chosen part's layers, the preview moves, and Bring to life makes the rig
 * from the parts (`made: 'parts'`).
 */
import type { Page } from '@playwright/test';
import { expect, openAmble, test } from '../helpers/app';
import { openStarter } from '../journeys/journey';
import { boardSize, circle, deskState, drawOnBoard, inkedLayers, openDesk, openStarterWorld, settle, tapOnBoard } from './desk';

type Bone = { name: string; x: number; y: number; x2: number; y2: number };

/** The hero's saved drawing: its bones (export px), its export's size and its version. */
async function heroArt(page: Page, world: string): Promise<{ version: number; w: number; h: number; bones: Bone[] } | null> {
  return page.evaluate(async (id) => {
    type Rec = { version: number; export: { w: number; h: number } | null; rigData: { bones: Bone[] } | null };
    const a = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }> } | null> }; art: { get(id: string): Promise<Rec | null> } } } }).__amble;
    const w = await a.store.worlds.get(id);
    const art = w?.cast.hero?.art;
    const rec = art ? await a.store.art.get(art) : null;
    return rec?.export && rec.rigData ? { version: rec.version, w: rec.export.w, h: rec.export.h, bones: rec.rigData.bones } : null;
  }, world);
}

test('the chosen side of On the bones | Freehand stays readable under the pointer', async ({ page }) => {
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/grumble`);
  const free = page.getByRole('radio', { name: 'Freehand' });
  await free.click();
  await expect(free).toHaveAttribute('aria-checked', 'true');
  // The pointer is still over it: its words keep the chosen option's purple (Scratch's selection colour).
  await free.hover();
  const [text, ink] = await free.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--change)';
    el.append(probe);
    const inkColour = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).color, inkColour];
  });
  expect(text).toBe(ink);
});

test('steps are picked by tapping, strokes land on the part, the preview moves, and the rig is made from the parts', async ({ page }) => {
  test.setTimeout(90_000);
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/hero`);

  // The hero opens on the bones, at the first step.
  const start = await deskState(page);
  expect(start.mode).toBe('bones');
  expect(start.part).toBe('torso');
  await expect(page.getByRole('button', { name: 'Body, drawing now' })).toHaveAttribute('aria-current', 'step');

  // Body: a torso around the body bones, filled.
  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.52, w * 0.12, 0, 360));
  await settle(page, 400);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, w / 2, h * 0.52);
  await settle(page, 500);
  expect(await inkedLayers(page)).toEqual(expect.arrayContaining(['torso-lines', 'torso']));

  // Still the body: the Desk never moves on by itself.
  expect((await deskState(page)).part).toBe('torso');

  // Head, by tapping its chip.
  await page.getByRole('button', { name: 'Head', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Head, drawing now' })).toHaveAttribute('aria-current', 'step');
  expect((await deskState(page)).part).toBe('head');
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('b');
  await drawOnBoard(page, circle(w / 2, h * 0.3, w * 0.1, 0, 360));
  await settle(page, 400);
  const inked = await inkedLayers(page);
  expect(inked).toContain('head-lines');
  expect(inked).not.toContain('armL-lines');
  await expect(page.getByRole('button', { name: 'Body, done' })).toBeVisible();

  // The preview moves: its picture changes over time.
  const canvas = page.locator('.preview__canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () => {
        const a = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        await page.waitForTimeout(250);
        const b = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
        return a !== b;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Bring to life: the rig is made from the parts.
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });
  const made = await page.evaluate(async (id) => {
    const a = (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ cast: Record<string, { art: string | null }> } | null> }; art: { get(id: string): Promise<{ rigInfo: { made: string } | null; mode: string; parts: Record<string, unknown> } | null> } } } }).__amble;
    const wld = await a.store.worlds.get(id);
    const art = wld?.cast.hero?.art;
    const rec = art ? await a.store.art.get(art) : null;
    return { made: rec?.rigInfo?.made ?? null, mode: rec?.mode ?? null, parts: Object.keys(rec?.parts ?? {}) };
  }, world);
  expect(made.made).toBe('parts');
  expect(made.mode).toBe('bones');
  expect(made.parts).toEqual(expect.arrayContaining(['torso', 'head']));
});

test('Bones from the Desk brings the drawing to life and opens its bones', async ({ page }) => {
  test.setTimeout(90_000);
  await openAmble(page);
  const world = await openStarterWorld(page);
  await openDesk(page, `#/w/${world}/draw/grumble`);
  const { w, h } = await boardSize(page);
  await drawOnBoard(page, circle(w / 2, h * 0.6, w * 0.2, 0, 360));
  await settle(page, 400);
  await page.getByRole('button', { name: 'Bones', exact: true }).click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}/bones/grumble`, world, { timeout: 30_000 });
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await expect(page.getByText('is only bones so far')).toHaveCount(0);
});

test('a starter’s drawing opens on its own bones: on its paper, and after Bring to life', async ({ page }) => {
  test.setTimeout(120_000);
  await openAmble(page);
  const world = await openStarter(page, 'moon-king');
  const saved = await heroArt(page, world);
  expect(saved).not.toBeNull();
  await openDesk(page, `#/w/${world}/draw/hero`);

  // Pip is drawn on a board of his own: his bones stand in the drawing, feet on the ground line.
  const desk = await page
    .waitForFunction(() => {
      type Probe = { board: { w: number; h: number; groundY: number | null }; art(): { box: [number, number, number, number] } | null; template(): { anchor: [number, number]; bones: Bone[] } | null };
      const d = (window as unknown as { __ambleDesk?: Probe | null }).__ambleDesk;
      const art = d?.art();
      const rig = d?.template();
      if (!d || !art || !rig) return null;
      const xs = rig.bones.flatMap((b) => [b.x, b.x2]);
      const ys = rig.bones.flatMap((b) => [b.y, b.y2]);
      return { ground: d.board.groundY, feet: rig.anchor[1], bones: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], art: art.box };
    }, null, { timeout: 30_000 })
    .then((h) => h.jsonValue());
  const [ax, ay, aw, ah] = desk!.art;
  expect(desk!.bones[0]).toBeGreaterThanOrEqual(ax - 2);
  expect(desk!.bones[1]).toBeGreaterThanOrEqual(ay - 2);
  expect(desk!.bones[2]).toBeLessThanOrEqual(ax + aw + 2);
  expect(desk!.bones[3]).toBeLessThanOrEqual(ay + ah + 2);
  expect(desk!.ground).toBe(Math.round(desk!.feet));

  // Bring to life rigs him on the same bones (in his new export's pixels).
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, world, { timeout: 30_000 });
  await expect.poll(async () => (await heroArt(page, world))?.version ?? 0, { timeout: 30_000 }).toBeGreaterThan(saved!.version);
  const after = (await heroArt(page, world))!;
  const off = saved!.bones.map((b) => {
    const n = after.bones.find((x) => x.name === b.name);
    return n ? Math.hypot(n.x / after.h - b.x / saved!.h, n.y / after.h - b.y / saved!.h) : 1;
  });
  expect(Math.max(...off)).toBeLessThan(0.06);
});
