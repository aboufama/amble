/**
 * Opening Amble in e2e tests (§8.4, §10.2), and the `test` every spec uses.
 *
 * `openAmble(page, { ai, clean, prefs, route })`: with `ai: 'mock'` it opens `/#class=<payload>` for
 * `https://ai.test/v1` with class code `TEST-1234` and presses **Join**, so the tested path is the class
 * link (call `mockAi(page, …)` first). `clean` clears IndexedDB and localStorage first; `prefs` are set
 * through the app (and saved); `route` is where to end up (`'#/trail'`).
 *
 * `test` (import it instead of Playwright's): fails a test on any native dialog (`alert`, `confirm`,
 * `prompt`), on any uncaught page error, and on any request that leaves the app (`trackEgress`).
 */
import { test as base, expect, type Page } from '@playwright/test';
import { trackEgress, type Egress } from './egress';
import { AI_BASE, CLASS_CODE, CLASS_HEADER, MOCK_MODEL } from './mockAi';

export { expect };

/** The class this suite joins (§4.2 `ClassLinkV1`). */
export const TEST_CLASS = {
  v: 1,
  cls: 'Test class',
  district: 'Test district',
  ai: {
    baseUrl: AI_BASE,
    model: MOCK_MODEL,
    fastModel: MOCK_MODEL,
    visionModel: MOCK_MODEL,
    caps: 'json_schema,stream,moderation',
    auth: { type: 'class-code', header: CLASS_HEADER, code: CLASS_CODE },
  },
  mode: 'on',
  level: 'middle',
  exp: null,
  asg: null,
} as const;

/** `base64url(JSON)` of a class link payload (the part after `#class=`). */
export function classLinkPayload(link: Record<string, unknown> = TEST_CLASS): string {
  return Buffer.from(JSON.stringify(link), 'utf8').toString('base64url');
}

export interface OpenAmbleOptions {
  ai?: 'mock' | 'none';
  clean?: boolean;
  prefs?: Record<string, unknown>;
  /** Where to go once Amble is up (default: stay where it opened). */
  route?: string;
  /** Overrides on the class link (`{ level: 'elementary' }`, `{ exp: '2020-01-01' }`). */
  classLink?: Record<string, unknown>;
}

/** Waits until the app has booted and a screen has rendered. */
export async function waitForApp(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __amble?: unknown }).__amble), null, { timeout: 30_000 });
  await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
}

/** Clears everything Amble keeps in this browser profile, then reloads. */
export async function cleanProfile(page: Page): Promise<void> {
  if (!/^https?:/.test(page.url())) await page.goto('./');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [{ name: 'amble' }];
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise<void>((resolve) => {
            if (!d.name) return resolve();
            const r = indexedDB.deleteDatabase(d.name);
            r.onsuccess = r.onerror = r.onblocked = () => resolve();
          }),
      ),
    );
  });
}

/** Goes to a route by its hash (`'#/trail'`) and waits for the screen. */
export async function gotoRoute(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await expect(page.locator('[data-testid^="screen-"]').first()).toBeVisible();
}

export async function openAmble(page: Page, o: OpenAmbleOptions = {}): Promise<void> {
  if (o.clean) await cleanProfile(page);
  if (o.ai === 'mock') {
    const link = { ...TEST_CLASS, ...o.classLink };
    await page.goto(`./#class=${classLinkPayload(link)}`);
    await waitForApp(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Join', exact: true }).click();
    await page.waitForFunction(
      (base) => {
        const s = (window as unknown as { __amble: { getState(): { config: { classLink: unknown; ai: { baseUrl?: string } | null } } } }).__amble.getState();
        return s.config.classLink !== null && s.config.ai?.baseUrl === base;
      },
      AI_BASE,
    );
  } else {
    await page.goto('./');
    await waitForApp(page);
  }
  if (o.prefs) {
    await page.evaluate((p) => (window as unknown as { __amble: { setPrefs(p: unknown): void } }).__amble.setPrefs(p), o.prefs);
  }
  if (o.route) await gotoRoute(page, o.route);
}

interface Guards {
  /** Native dialogs seen (each one fails the test). */
  nativeDialogs: string[];
  pageErrors: string[];
  egress: Egress;
}

export const test = base.extend<{ guards: Guards }>({
  guards: [
    async ({ page, baseURL }, use) => {
      const guards: Guards = { nativeDialogs: [], pageErrors: [], egress: trackEgress(page, { appOrigin: baseURL ? new URL(baseURL).origin : undefined }) };
      page.on('dialog', (d) => {
        guards.nativeDialogs.push(`${d.type()}: ${d.message()}`);
        void d.dismiss().catch(() => undefined);
      });
      page.on('pageerror', (e) => guards.pageErrors.push(`${e.name}: ${e.message}`));
      await use(guards);
      guards.egress.stop();
      expect(guards.nativeDialogs, 'native dialogs (use src/ui/dialogs.ts)').toEqual([]);
      expect(guards.pageErrors, 'uncaught page errors').toEqual([]);
      expect(guards.egress.violations, 'requests that left the app').toEqual([]);
    },
    { auto: true },
  ],
});
