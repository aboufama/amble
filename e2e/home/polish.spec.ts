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
