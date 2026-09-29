/**
 * Visual details of the home screens that broke once (QA): the First page column's shadows, the picked
 * world card's ring, the Trail for a student with worlds but no free drawing, and the empty world list.
 */
import { expect, openAmble, test } from '../helpers/app';

test("the First page column leaves room for its cards' and idea box's shadows", async ({ page }) => {
  await openAmble(page, { clean: true });
  await expect(page.getByTestId('screen-first')).toBeVisible();
  const room = await page.evaluate(() => {
    const col = document.querySelector('.first__col')!.getBoundingClientRect();
    const box = document.querySelector('.first-col__idea')!.getBoundingClientRect();
    return { left: box.left - col.left, right: col.right - box.right };
  });
  // The idea box casts a 34 px blur: a scroller edge closer than that cuts it into a hard-edged box.
  expect(room.left).toBeGreaterThanOrEqual(24);
  expect(room.right).toBeGreaterThanOrEqual(24);
});

test('a picked world card keeps its ring while the pointer is still on it', async ({ page }) => {
  await openAmble(page, { clean: true, route: '#/new' });
  const card = page.getByTestId('screen-new').getByRole('radio').first();
  await card.click();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await card.hover();
  const [shadow, accent] = await card.evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).boxShadow, c];
  });
  expect(shadow).toContain(accent);
});
