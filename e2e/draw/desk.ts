/**
 * Desk helpers for the e2e specs: open a starter world and a drawing, draw in board pixels, read pixels
 * back through the Desk's dev hook (`window.__ambleDesk`, the open drawing's controller).
 */
import type { Page } from '@playwright/test';
import { expect, gotoRoute } from '../helpers/app';
import { stroke, type StrokeOptions } from '../helpers/pen';

type Hook = {
  getSnapshot(): Record<string, unknown> & { ready: boolean; tool: string; part: string | null; inked: number; mode: string; active: string };
  surface: {
    docToClient(x: number, y: number): { x: number; y: number };
    readPixels(layer: string | null, x: number, y: number, w: number, h: number): Uint8ClampedArray;
    layers(): Array<{ id: string; role: string; empty: boolean }>;
  };
  board: { w: number; h: number };
};

/** Opens the Moon King starter and returns its world id. */
export async function openStarterWorld(page: Page): Promise<string> {
  await gotoRoute(page, '#/starter/moon-king');
  await expect(page.getByTestId('screen-world')).toBeVisible();
  await page.waitForFunction(() => /^#\/w\//.test(location.hash));
  return new URL(page.url()).hash.replace('#/w/', '');
}

/** Goes to a Desk route and waits until the drawing takes input. */
export async function openDesk(page: Page, hash: string): Promise<void> {
  await gotoRoute(page, hash);
  await expect(page.getByTestId('screen-draw')).toBeVisible();
  await page.waitForFunction(() => {
    const d = (window as unknown as { __ambleDesk?: Hook | null }).__ambleDesk;
    return !!d && d.getSnapshot().ready;
  }, null, { timeout: 30_000 });
  await expect(page.locator('.desk__sheet canvas')).toBeVisible();
}

export async function deskState(page: Page): Promise<ReturnType<Hook['getSnapshot']>> {
  return page.evaluate(() => {
    const d = (window as unknown as { __ambleDesk: Hook }).__ambleDesk;
    const s = d.getSnapshot();
    return JSON.parse(JSON.stringify({ ...s, layers: undefined, frames: undefined })) as ReturnType<Hook['getSnapshot']>;
  });
}

export async function boardSize(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    const d = (window as unknown as { __ambleDesk: Hook }).__ambleDesk;
    return { w: d.board.w, h: d.board.h };
  });
}

/** Board px → CSS px relative to the sheet element (what `stroke` takes). */
export async function toSheet(page: Page, pts: Array<[number, number]>): Promise<Array<[number, number]>> {
  return page.evaluate((points) => {
    const d = (window as unknown as { __ambleDesk: Hook }).__ambleDesk;
    const el = document.querySelector('[data-testid="desk-board"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    return points.map(([x, y]) => {
      const c = d.surface.docToClient(x, y);
      return [c.x - r.left, c.y - r.top] as [number, number];
    });
  }, pts);
}

/** A stroke through board-px points. */
export async function drawOnBoard(page: Page, pts: Array<[number, number]>, o: StrokeOptions = {}): Promise<void> {
  await stroke(page, page.getByTestId('desk-board'), await toSheet(page, pts), { pointer: 'pen', ...o });
}

/** A tap at a board-px point. */
export async function tapOnBoard(page: Page, x: number, y: number, o: StrokeOptions = {}): Promise<void> {
  await drawOnBoard(page, [
    [x, y],
    [x + 0.2, y + 0.2],
  ], o);
}

/** Alpha of one board pixel on a layer (null: the composite). */
export async function alphaAt(page: Page, layer: string | null, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([l, px, py]) => {
      const d = (window as unknown as { __ambleDesk: Hook }).__ambleDesk;
      return d.surface.readPixels(l as string | null, px as number, py as number, 1, 1)[3];
    },
    [layer, x, y] as const,
  );
}

/** Ids of the layers that have ink. */
export async function inkedLayers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const d = (window as unknown as { __ambleDesk: Hook }).__ambleDesk;
    return d.surface.layers().filter((l) => !l.empty).map((l) => l.id);
  });
}

/** Points around a circle (board px), from a0 to a1 degrees. */
export function circle(cx: number, cy: number, r: number, a0 = 0, a1 = 360, n = 72): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Waits until the drawing's work after a pen-up (history, the preview export) has settled. */
export async function settle(page: Page, ms = 250): Promise<void> {
  await page.waitForTimeout(ms);
}
