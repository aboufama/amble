/**
 * Review screenshots of every Bones state at 1366x768 and 1280x800 (skipped unless BONES_SHOTS=1; the
 * files go to BONES_SHOTS_DIR, outside the repo). Not a test of behaviour: bones.spec.ts is.
 */
import { expect, openAmble, test } from '../helpers/app';
import { seedDrawing } from './seed';

const DIR = process.env.BONES_SHOTS_DIR ?? 'test-results/bones-shots';
const SIZES = [
  { w: 1366, h: 768, tag: '1366' },
  { w: 1280, h: 800, tag: '1280' },
];

test.skip(!process.env.BONES_SHOTS, 'screenshots only on request (BONES_SHOTS=1)');

for (const size of SIZES) {
  test(`Bones states at ${size.tag}`, async ({ page }) => {
    await page.setViewportSize({ width: size.w, height: size.h });
    await openAmble(page, { clean: true });
    const shot = (name: string) => page.screenshot({ path: `${DIR}/${name}-${size.tag}.png` });

    // a hero in a world, found fresh by Bones ("Finding bones…" then the constellation)
    const hero = await seedDrawing(page, { sample: 'hero', name: 'Pip', castKey: 'hero' });
    await page.evaluate((h) => (location.hash = h), `#/w/${hero.worldId}/bones/hero`);
    await expect(page.getByTestId('bones-status')).toContainText('Amble found');
    await expect(page.getByTestId('bones-preview')).not.toHaveAttribute('data-bones', '');
    await page.waitForTimeout(900);
    await shot('01-found');

    // a star picked with the keyboard: the name bubble and the lantern ring
    const elbow = page.getByRole('button', { name: /^Left elbow/ });
    await elbow.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(300);
    await shot('02-picked');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await shot('03-hand');

    // Show pieces
    await page.getByRole('switch', { name: 'Show pieces' }).click();
    await page.waitForTimeout(400);
    await shot('04-pieces');
    await page.getByRole('switch', { name: 'Show pieces' }).click();

    // the kind picker
    await page.getByRole('button', { name: /What is it\?/ }).click();
    await page.waitForTimeout(300);
    await shot('05-kind');
    await page.keyboard.press('Escape');

    // wiggly mode
    await page.getByRole('button', { name: 'Add a wiggly bit' }).click();
    await page.waitForTimeout(200);
    await shot('06-wiggly');
    await page.getByRole('button', { name: 'Add a wiggly bit' }).click();

    // a bone's card
    const bone = page.locator('.bone-hits line[data-bone="armR1"]');
    const box = await bone.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    await shot('07-bone-card');
    await page.keyboard.press('Escape');

    // Amble's guess (a low-confidence drawing, free)
    const guess = await seedDrawing(page, { sample: 'astronaut', name: 'Rae', rigged: true, confidence: 0.45, notes: ['The legs almost touch, so they looked stuck together. I split them. If a knee is in the wrong place, drag it.'] });
    await page.evaluate((h) => (location.hash = h), `#/bones/${guess.artId}`);
    await expect(page.getByTestId('bones-guess')).toBeVisible();
    await page.waitForTimeout(900);
    await shot('08-guess');

    // other kinds
    for (const sample of ['slime', 'dog', 'bird'] as const) {
      const s = await seedDrawing(page, { sample, name: sample === 'slime' ? 'Blorp' : sample === 'dog' ? 'Rex' : 'Tweet' });
      await page.evaluate((h) => (location.hash = h), `#/bones/${s.artId}`);
      await expect(page.getByTestId('bones-status')).toContainText(/Amble found/);
      await page.waitForTimeout(900);
      await shot(`09-${sample}`);
    }

    // no kind yet: What is it? opens by itself
    const item = await seedDrawing(page, { sample: 'slime', name: 'Blorp', rigKind: 'none' });
    await page.evaluate((h) => (location.hash = h), `#/bones/${item.artId}`);
    await expect(page.getByRole('dialog', { name: 'What is it?' })).toBeVisible();
    await page.waitForTimeout(700);
    await shot('12-pick-kind');
    await page.keyboard.press('Escape');

    // the drawing changed since its bones: Redo bones
    const stale = await seedDrawing(page, { sample: 'hero', name: 'Pip', rigged: true, bonesSize: [120, 140] });
    await page.evaluate((h) => (location.hash = h), `#/bones/${stale.artId}`);
    await expect(page.getByTestId('bones-stale')).toBeVisible();
    await page.waitForTimeout(900);
    await shot('13-redo');

    // Day theme, the touch layout, reduced motion
    const setPrefs = (p: Record<string, unknown>) => page.evaluate((x) => (window as unknown as { __amble: { setPrefs(p: unknown): void } }).__amble.setPrefs(x), p);
    await setPrefs({ theme: 'day' });
    await page.evaluate((h) => (location.hash = h), `#/w/${hero.worldId}/bones/hero`);
    await expect(page.getByTestId('bones-status')).toContainText(/bones/);
    await page.waitForTimeout(900);
    await shot('14-day');
    await setPrefs({ theme: 'contrast' });
    await page.waitForTimeout(300);
    await shot('15-contrast');
    await setPrefs({ theme: 'night', reduceMotion: 'on' });
    await page.evaluate(() => {
      document.documentElement.dataset.layout = 'touch';
    });
    await page.waitForTimeout(600);
    await shot('16-touch-reduced');
    await page.evaluate(() => {
      delete document.documentElement.dataset.layout;
    });
    await setPrefs({ reduceMotion: 'system' });

    // just bones (undrawn) and missing
    await page.evaluate((h) => (location.hash = h), `#/w/${hero.worldId}/bones/boss`);
    await expect(page.getByText(/only bones so far/)).toBeVisible();
    await page.waitForTimeout(700);
    await shot('10-undrawn');
    await page.evaluate(() => (location.hash = '#/bones/a_missing0001'));
    await expect(page.getByText("This drawing isn't here.")).toBeVisible();
    await page.waitForTimeout(700);
    await shot('11-missing');
  });
}
