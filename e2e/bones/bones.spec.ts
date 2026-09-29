/**
 * Bones (§2.11, §7.11, §8.5 M4): stars by keyboard and by drag, the preview following the bones,
 * Mirror sides, What is it?, Feel, wiggly bits, Remove, undo, and Done (made by hand, a footstep, back
 * where the student came from). No AI anywhere: Magic bones and the rest run on the device.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { readArt, readSteps, seedDrawing } from './seed';

/** "Left elbow, at 64 by 179. …" → [64, 179]. */
async function starAt(page: Page, name: RegExp): Promise<[number, number]> {
  const label = (await page.getByRole('button', { name }).getAttribute('aria-label')) ?? '';
  const m = /at (-?\d+) by (-?\d+)/.exec(label);
  if (!m) throw new Error(`no position in "${label}"`);
  return [Number(m[1]), Number(m[2])];
}

async function openBones(page: Page, hash: string): Promise<void> {
  await gotoRoute(page, hash);
  await expect(page.getByTestId('bones-status')).toContainText(/Amble found \d+ bones/);
  await expect(page.getByTestId('bones-preview')).not.toHaveAttribute('data-bones', '');
}

/** The newest bones reach the store (they save about 0.6 s after an edit). */
async function savedRig(page: Page, artId: string, until: (rig: NonNullable<Awaited<ReturnType<typeof readArt>>>) => boolean) {
  await expect.poll(async () => {
    const art = await readArt(page, artId);
    return art ? until(art) : false;
  }).toBe(true);
  return (await readArt(page, artId))!;
}

test.beforeEach(async ({ page }) => {
  await openAmble(page, { clean: true });
});

test('Tab to a star, pick it up with Enter, move it with arrows; the preview follows; Done makes it hand-made with a footstep', async ({ page }) => {
  const { artId, worldId } = await seedDrawing(page, { sample: 'hero', name: 'Pip', castKey: 'hero' });
  await openBones(page, `#/w/${worldId}/bones/hero`);
  await expect(page.getByRole('heading', { name: "Pip's bones" })).toBeVisible();

  // Tab goes from the tools into the stars
  await page.getByRole('switch', { name: 'Show pieces' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveAttribute('data-joint', /.+/);
  for (let i = 0; i < 24; i++) {
    const label = (await page.locator(':focus').getAttribute('aria-label')) ?? '';
    if (label.startsWith('Left elbow')) break;
    await page.keyboard.press('Tab');
  }
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Left elbow, at \d+ by \d+\. Arrow keys move it by 1, Shift\+arrow by 10\. Enter picks it up\.$/);
  await expect(page.locator('.joint-tip')).toContainText('Left elbow');
  const [x0, y0] = await starAt(page, /^Left elbow/);
  const bonesBefore = await page.getByTestId('bones-preview').getAttribute('data-bones');

  await page.keyboard.press('Enter');
  await expect(page.locator('.joint--picked')).toHaveCount(1);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.joint--picked')).toHaveCount(0);
  expect(await starAt(page, /^Left elbow/)).toEqual([x0 - 5, y0 + 10]);

  // the preview re-binds with the new bones
  await expect(page.getByTestId('bones-preview')).not.toHaveAttribute('data-bones', bonesBefore ?? '');
  await expect(page.getByTestId('bones-status')).toHaveText('You placed these bones');

  // one pick-up is one undo step
  await page.keyboard.press('Control+z');
  expect(await starAt(page, /^Left elbow/)).toEqual([x0, y0]);
  await page.keyboard.press('Control+Shift+z');
  expect(await starAt(page, /^Left elbow/)).toEqual([x0 - 5, y0 + 10]);

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  const art = await readArt(page, artId);
  expect(art?.rigData?.made).toBe('hand');
  expect(art?.rigInfo?.made).toBe('hand');
  const steps = await readSteps(page, worldId!);
  expect(steps.at(-1)).toMatchObject({ kind: 'bones', by: 'student', text: "You fixed Pip's bones", cast: 'hero' });
});

test('arrow keys nudge a focused star (bursts are one step), and a drag moves it too', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  const knee = page.getByRole('button', { name: /^Right knee/ });
  await knee.focus();
  const [x0, y0] = await starAt(page, /^Right knee/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  expect(await starAt(page, /^Right knee/)).toEqual([x0 + 2, y0 - 10]);
  await page.keyboard.press('Control+z');
  expect(await starAt(page, /^Right knee/)).toEqual([x0, y0]);

  // drag the left hand with a mouse: the drawing stays put, the star follows
  const hand = page.getByRole('button', { name: /^Left hand/ });
  const box = (await hand.boundingBox())!;
  const art = page.locator('.bones-sky__art');
  const artBefore = await art.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  const moved = (await hand.boundingBox())!;
  expect(moved.x).toBeLessThan(box.x - 12);
  expect(moved.y).toBeLessThan(box.y - 20);
  expect(await art.boundingBox()).toEqual(artBefore);
  await savedRig(page, artId, (a) => a.rigData?.made === 'hand');
});

test('Mirror sides copies the fixed side onto the other, about the spine', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  await page.getByRole('button', { name: /^Left elbow/ }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Mirror sides' }).click();
  const art = await savedRig(page, artId, (a) => {
    const bones = a.rigData?.bones as Array<{ role: string; x: number; y: number }> | undefined;
    const l = bones?.find((b) => b.role === 'armL2');
    const r = bones?.find((b) => b.role === 'armR2');
    return !!l && !!r && Math.abs(l.y - r.y) < 0.01;
  });
  const bones = art.rigData!.bones as Array<{ role: string; x: number; y: number; x2: number }>;
  const spine = bones.find((b) => b.role === 'spine')!;
  const axis = (spine.x + spine.x2) / 2;
  const l = bones.find((b) => b.role === 'armL2')!;
  const r = bones.find((b) => b.role === 'armR2')!;
  expect(r.x).toBeCloseTo(2 * axis - l.x, 3);
  const [lx, ly] = await starAt(page, /^Left elbow/);
  const [rx, ry] = await starAt(page, /^Right elbow/);
  expect(ry).toBe(ly);
  expect(Math.abs(rx - Math.round(2 * axis - lx))).toBeLessThanOrEqual(1);
});

test('What is it? re-rigs as another kind, and turns the facing', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  await expect(page.getByRole('button', { name: /^Left elbow/ })).toBeVisible();
  await page.getByRole('button', { name: /What is it\? A person, facing you/ }).click();
  const card = page.getByRole('dialog', { name: 'What is it?' });
  await card.getByRole('radio', { name: 'Blob' }).click();
  await expect(page.getByTestId('bones-status')).toContainText(/Amble found \d+ bone/);
  await expect(page.getByRole('button', { name: /^Left elbow/ })).toHaveCount(0);
  await card.getByRole('radio', { name: 'Looks right →' }).click();
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /What is it\? A blob, facing right/ })).toBeVisible();
  const art = await savedRig(page, artId, (a) => a.rigData?.kind === 'blob' && a.facing === 'right');
  expect(art.rig).toBe('blob');
  // Undo brings the person back
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Left elbow/ })).toBeVisible();
});

test('Bouncy and Speedy change the move the preview plays', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  const preview = page.getByTestId('bones-preview');
  await expect(preview).toHaveAttribute('data-clip', 'walk');
  await expect(preview).toHaveAttribute('data-amount', '1.00');
  const frames = async () => {
    const a = await preview.screenshot();
    await page.waitForTimeout(250);
    const b = await preview.screenshot();
    return !a.equals(b);
  };
  expect(await frames()).toBe(true);

  await page.getByRole('slider', { name: 'Bouncy' }).focus();
  await page.keyboard.press('End');
  await expect(preview).toHaveAttribute('data-amount', '2.00');
  await expect(page.locator('.feel-row__value').first()).toHaveText('Boing!');
  await page.getByRole('slider', { name: 'Speedy' }).focus();
  await page.keyboard.press('Home');
  await expect(preview).toHaveAttribute('data-speed', '0.50');
  expect(await frames()).toBe(true);
  const art = await savedRig(page, artId, (a) => a.rigData?.anims?.walk?.amount === 2 && a.rigData?.anims?.walk?.speed === 0.5);
  expect(art.rigData?.anims?.walk).toEqual({ amount: 2, speed: 0.5 });

  // another move has its own Feel
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(preview).toHaveAttribute('data-clip', 'run');
  await expect(preview).toHaveAttribute('data-amount', '1.00');
});

test('a wiggly bit grows out of a star, and a bone can be removed or held stiff', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  const count = async () => page.locator('.bone-hits line').count();
  const before = await count();

  await page.getByRole('button', { name: 'Add a wiggly bit' }).click();
  await expect(page.locator('#bones-keys')).toContainText('Drag out from any star to add a wiggly bit: hair, a tail, a scarf.');
  await page.getByRole('button', { name: /^Head top/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Wiggly bit \d+ tip/);
  expect(await count()).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Add a wiggly bit' })).toHaveAttribute('aria-pressed', 'false');

  // the bone list (for screen readers, shown on focus) opens a bone's card
  await page.getByRole('tree').getByRole('treeitem').first().focus();
  await expect(page.locator('.bone-tree--open')).toBeVisible();
  const item = page.getByRole('treeitem', { name: /^Right lower arm/ });
  await item.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: 'The right lower arm' });
  await card.getByRole('button', { name: "Something I'm holding" }).click();
  await expect(card.getByRole('button', { name: "Something I'm holding" })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Right hand/ })).toHaveCount(0);
  const art = await savedRig(page, artId, (a) => !(a.rigData?.bones as Array<{ role: string }>).some((b) => b.role === 'armR2'));
  expect((art.rigData?.bones as Array<{ role: string }>).some((b) => b.role === 'extra')).toBe(true);
});

test("Amble's guess says why in words when it isn't sure", async ({ page }) => {
  const { artId } = await seedDrawing(page, {
    sample: 'astronaut', name: 'Rae', rigged: true, confidence: 0.45,
    notes: ['The legs almost touch, so they looked stuck together. I split them. If a knee is in the wrong place, drag it.'],
  });
  await openBones(page, `#/bones/${artId}`);
  const note = page.getByTestId('bones-guess');
  await expect(note).toContainText("Amble's guess");
  await expect(note).toContainText('The legs almost touch, so they looked stuck together.');
  // a star moved by hand: the student has checked, the guess goes away
  await page.getByRole('button', { name: /^Left knee/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(note).toHaveCount(0);
});

test('a free drawing returns to the Trail on Done; undrawn and missing drawings say so', async ({ page }) => {
  const { artId, worldId } = await seedDrawing(page, { sample: 'hero', name: 'Pip', castKey: 'hero' });
  // arriving from somewhere that isn't the drawing's place (Settings): Done goes to the Trail
  await gotoRoute(page, '#/settings');
  await openBones(page, `#/bones/${artId}`);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/#\/trail$/);

  await gotoRoute(page, `#/w/${worldId}/bones/boss`);
  await expect(page.getByRole('heading', { name: /only bones so far/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Draw / })).toHaveAttribute('href', `#/w/${worldId}/draw/boss`);

  await gotoRoute(page, '#/bones/a_test000001');
  await expect(page.getByTestId('screen-bones')).toBeVisible();
  await expect(page.getByRole('heading', { name: "This drawing isn't here." })).toBeVisible();
});

test('under reduced motion the preview waits, still, until Play', async ({ page }) => {
  await page.evaluate(() => (window as unknown as { __amble: { setPrefs(p: unknown): void } }).__amble.setPrefs({ reduceMotion: 'on' }));
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  const preview = page.getByTestId('bones-preview');
  await expect(preview).toHaveAttribute('data-playing', 'no');
  await expect(preview).toContainText('Paused');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(preview).toHaveAttribute('data-playing', 'yes');
  await expect(preview).toContainText('Walking');
});

test('a drawing that changed a lot since its bones offers Redo bones', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip', rigged: true, bonesSize: [120, 140] });
  await openBones(page, `#/bones/${artId}`);
  const note = page.getByTestId('bones-stale');
  await expect(note).toContainText('Your drawing changed');
  await note.getByRole('button', { name: 'Redo bones' }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('bones-status')).toContainText(/Amble found \d+ bones/);
  const art = await savedRig(page, artId, (a) => !!a.rigData && !/^120x140:/.test((a.rigData as unknown as { artHash: string }).artHash));
  expect(art.rigData?.kind).toBe('biped');
});

test('a drawing with no kind yet asks what it is, then finds its bones', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'slime', name: 'Blorp', rigKind: 'none' });
  await gotoRoute(page, `#/bones/${artId}`);
  await expect(page.getByTestId('bones-status')).toHaveText('Pick what it is, and Amble will find its bones.');
  const card = page.getByRole('dialog', { name: 'What is it?' });
  await expect(card).toBeVisible();
  await card.getByRole('radio', { name: 'Blob' }).click();
  await expect(page.getByTestId('bones-status')).toContainText(/Amble found \d+ bone/);
  await savedRig(page, artId, (a) => a.rigData?.kind === 'blob' && a.rig === 'blob');
});

test('Bones has no WCAG 2.1 A/AA problems (axe), with its cards open too', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  await openBones(page, `#/bones/${artId}`);
  await page.waitForTimeout(600);
  const scan = async (what: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${what}: ${v.id} (${v.nodes.length}) ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  };
  await scan('screen');
  await page.getByRole('button', { name: /^Left elbow/ }).focus();
  await scan('a star with its name');
  await page.getByRole('button', { name: /What is it\?/ }).click();
  await scan('What is it?');
  await page.keyboard.press('Escape');
  await page.getByRole('tree').getByRole('treeitem').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.bone-card')).toBeVisible();
  await scan("a bone's card");
});

test('no page scroll, and the key controls show, at every layout size', async ({ page }) => {
  const { artId } = await seedDrawing(page, { sample: 'hero', name: 'Pip' });
  for (const [w, h] of [[1366, 768], [1366, 657], [1280, 800], [1280, 600], [1024, 600], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await openBones(page, `#/bones/${artId}`);
    const size = `${w}x${h}`;
    const scroll = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth }));
    expect(scroll.w, size).toBeLessThanOrEqual(scroll.iw);
    if (w > h) expect(scroll.h, size).toBeLessThanOrEqual(scroll.ih);
    for (const control of [page.getByRole('button', { name: 'Done' }), page.getByRole('button', { name: 'Magic bones' }), page.getByRole('button', { name: /^Left elbow/ })]) {
      await expect(control, size).toBeInViewport();
    }
    await gotoRoute(page, '#/settings');
  }
});
