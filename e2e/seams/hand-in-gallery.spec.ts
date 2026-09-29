/**
 * Seam M7 + M6 (§8.6): Hand in saves the file, and the gallery reads it. A student draws their hero in a
 * world with an assignment, hands it in (initials in the name, Save to Drive through the save picker, I
 * turned it in), and the teacher opens that Classroom folder in the gallery: the card is that very file,
 * with the student's initials and the checklist worked out from what the file holds.
 */
import { expect, gotoRoute, openAmble, test } from '../helpers/app';
import { deskReady, drawOnDesk, keyOfRole, worldReady } from '../journeys/journey';

const FILE = 'Moon King - J.R.amble';

test('the file Hand in saves is the file the class gallery reads', async ({ page }) => {
  test.setTimeout(240_000);
  // The save picker writes into a "class" folder of the origin-private file system; the folder picker
  // opens that folder (the Classroom folder the teacher syncs).
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const folder = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('class', { create: true });
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => (await folder()).getFileHandle(o?.suggestedName ?? 'untitled', { create: true });
    w.showDirectoryPicker = async () => folder();
    const proto = FileSystemHandle.prototype as unknown as { queryPermission?: unknown; requestPermission?: unknown };
    proto.queryPermission = async () => 'granted';
    proto.requestPermission = async () => 'granted';
  });
  await openAmble(page, { clean: true });
  await page.evaluate(async () => {
    await (await navigator.storage.getDirectory()).removeEntry('class', { recursive: true }).catch(() => undefined);
  });

  // A Moon King seed with the class's assignment (as a class link's assignment makes it).
  const worldId = await page.evaluate(async () => {
    const a = (window as unknown as { __amble: { services: { starters: { open(id: string, o: { withArt: boolean }): Promise<{ world: Record<string, unknown> }> }; store: { commit(c: unknown): Promise<void> } }; navigate(r: unknown): void } }).__amble;
    const { world } = await a.services.starters.open('moon-king', { withArt: false });
    const hero = (world as { cast: Record<string, unknown> }).cast.hero ? 'hero' : Object.keys((world as { cast: Record<string, unknown> }).cast)[0];
    world.assignment = {
      id: 'as_boss',
      title: 'Boss Battle Week',
      text: 'Draw your own hero and fight the boss.',
      starter: 'moon-king',
      require: [],
      goals: [
        { id: 'g1', label: 'Hero drawn by the student', kind: 'auto', check: { type: 'drawn', key: hero } },
        { id: 'g2', label: 'Boss has 2+ attacks', kind: 'auto', check: { type: 'boss-attacks', min: 2 } },
      ],
      ai: 'on',
      level: null,
      due: 'Friday',
      locked: {},
    };
    await a.services.store.commit({ worlds: [world] });
    a.navigate({ name: 'world', id: world.id as string });
    return world.id as string;
  });
  await worldReady(page);

  // The student draws their hero.
  const hero = await keyOfRole(page, 'hero');
  await page.getByTestId(`cast-card-${hero.key}`).click();
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/draw/${hero.key}$`), { timeout: 20_000 });
  await deskReady(page);
  await drawOnDesk(page);
  await page.getByTestId('bring-to-life').click();
  await page.waitForFunction((id) => location.hash === `#/w/${id}`, worldId, { timeout: 60_000 });

  // Hand in: the checklist sees the drawing; initials name the file; Save to Drive; I turned it in.
  await page.getByTestId('handin-button').click();
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}/handin$`));
  const sheet = page.getByRole('dialog', { name: /^Hand in your world/ });
  await expect(sheet).toContainText('Boss Battle Week');
  await expect(sheet).not.toContainText('Your hero is still just bones.');
  await sheet.getByLabel('Your initials').fill('J.R.');
  await expect(sheet.getByLabel('File name')).toHaveValue(FILE);
  await sheet.getByTestId('save-drive').click();
  await expect.poll(() => page.evaluate(async (name) => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('class')).getFileHandle(name)).getFile()).size, FILE).catch(() => 0), { timeout: 30_000 }).toBeGreaterThan(1000);
  await sheet.getByTestId('turned-in').click();
  await expect(sheet).toBeHidden();
  const saved = await page.evaluate((id) => (window as unknown as { __amble: { store: { worlds: { get(id: string): Promise<{ handIn: { fileName: string | null; method: string | null; turnedInAt: number | null }; steps: Array<{ kind: string }> } | null> } } } }).__amble.store.worlds.get(id), worldId);
  expect(saved?.handIn).toMatchObject({ fileName: FILE, method: 'fs-access' });
  expect(saved?.handIn.turnedInAt).toBeGreaterThan(0);
  expect(saved?.steps.at(-1)?.kind).toBe('handin');

  // The teacher opens the Classroom folder: one card, this file, with the checks from its contents.
  await gotoRoute(page, '#/teacher/gallery');
  const gallery = page.getByTestId('teacher-gallery');
  await gallery.getByTestId('open-folder').click();
  const card = gallery.getByTestId('gallery-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Moon King');
  await expect(gallery).toContainText('Boss Battle Week');
  await card.click();
  const detail = page.getByTestId('gallery-detail');
  await expect(detail.getByRole('heading', { name: /Moon King/ })).toContainText('by J.R.');
  await expect(detail.locator('.gchecks__row').filter({ hasText: 'Hero drawn by the student' })).toHaveClass(/gchecks__row--pass/);
  await expect(detail.locator('.gchecks__row').filter({ hasText: 'Boss has 2+ attacks' })).toHaveClass(/gchecks__row--pass/);
});
