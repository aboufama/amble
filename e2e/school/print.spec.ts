/**
 * Printing the in-app pages (§2.15): the parent letter, the poster and the notices print black on white in
 * every theme, even with Chrome's default settings (no background graphics), and the letter and the poster
 * print as sheets of their own, without the app's page heading.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';

/** Relative luminance of a computed `rgb(...)` colour. */
function luminance(css: string): number {
  const [r, g, b] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const theme of ['night', 'contrast'] as const) {
  test(`pages print dark words on white paper (${theme} theme)`, async ({ page }) => {
    await openAmble(page, { clean: true, prefs: { theme } });
    for (const name of ['parents', 'poster', 'privacy'] as const) {
      await page.emulateMedia({ media: 'screen' });
      await gotoRoute(page, `#/${name}`);
      await expect(page.locator(`[data-page="${name}"] .page`)).toBeVisible();
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => {
        const words = document.querySelector('.page p, .page li')!;
        return { text: getComputedStyle(words).color, paper: getComputedStyle(document.body).backgroundColor };
      });
      expect(luminance(printed.text), `${name}: words print dark (${printed.text})`).toBeLessThan(0.1);
      expect(luminance(printed.paper), `${name}: the page prints white (${printed.paper})`).toBeGreaterThan(0.9);
      if (name !== 'privacy') await expect(page.locator(`[data-page="${name}"] .page__head`), `${name}: prints as its own sheet`).toBeHidden();
    }
    await page.emulateMedia({ media: 'screen' });
  });
}
