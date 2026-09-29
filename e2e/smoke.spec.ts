import { expect, test } from '@playwright/test';

test('the app loads without console errors and shows the placeholder', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle('Amble');
  await expect(page.getByRole('heading', { level: 1, name: 'Amble' })).toBeVisible();
  await expect(page.getByText('A new Amble is on its way.')).toBeVisible();
  expect(errors).toEqual([]);
});
