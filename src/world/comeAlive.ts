/**
 * The two flights between the world and the Desk (§2.17, §3.6):
 * - **Come alive** (900 ms): the drawing's sticker flies from the Desk sheet to the character's box in
 *   the running world along an arc (0-450 ms, ease-amble), settles 1.06 → 1 while the game swaps it in
 *   (450-650 ms), then the game cheers and eight mint sparks drift up from its feet (650-900 ms). Reduced
 *   motion: a 200 ms crossfade and no sparks.
 * - **Lift** (320 ms): a white sheet with the member's picture on it grows from its box toward the Desk
 *   sheet, named `desk-sheet` for the View Transition into the Desk (the Desk names its sheet the same).
 * Both move only by translating, scaling and fading: nothing tilts.
 *
 * Both draw in a fixed layer above the game, so nothing ever happens inside the sandboxed frame.
 */
import type { Box } from './objects';

export const ALIVE_MS = 900;
export const FLY_MS = 450;
export const SETTLE_MS = 200;
export const LIFT_MS = 320;
export const SPARKS = 8;
/** The View Transition name the lift card and the Desk's sheet share. */
export const DESK_SHEET_TRANSITION = 'desk-sheet';

const EASE_AMBLE = 'cubic-bezier(.3,.7,.2,1)';
const EASE_POP = 'cubic-bezier(.34,1.56,.64,1)';
const EASE_LIFT = 'cubic-bezier(.2,.9,.25,1.15)';

export interface FlightPlan {
  /** Where the sticker starts and lands (page px, the image's box). */
  from: Box;
  to: Box;
  /** How high the arc rises above the straight line, in px. */
  lift: number;
}

/** The landing box: the sticker scaled to fit the target, sitting on its feet line. */
export function landing(target: Box, aspect: number): Box {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  let w = target.w;
  let h = w / a;
  if (h > target.h) {
    h = target.h;
    w = h * a;
  }
  return { x: target.x + (target.w - w) / 2, y: target.y + target.h - h, w, h };
}

export function planFlight(from: Box, target: Box, aspect: number): FlightPlan {
  const to = landing(target, aspect);
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  const dist = Math.hypot(dx, dy);
  return { from, to, lift: Math.min(160, Math.max(40, dist * 0.28)) };
}

function layer(): HTMLElement {
  let el = document.getElementById('amble-flights');
  if (!el) {
    el = document.createElement('div');
    el.id = 'amble-flights';
    el.className = 'flights';
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
  }
  return el;
}

function wait(anim: Animation): Promise<void> {
  return anim.finished.then(
    () => undefined,
    () => undefined,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function imageAspect(src: string): Promise<{ img: HTMLImageElement; aspect: number }> {
  const img = new Image();
  img.decoding = 'async';
  img.alt = '';
  img.src = src;
  try {
    await img.decode();
  } catch {
    // A broken URL still flies as an empty box; the swap in the game is what matters.
  }
  return { img, aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1 };
}

export interface ComeAliveOptions {
  sticker: string;
  from: Box;
  /** The character's box on the page, or null (then it lands on `fallback`, e.g. its cast card). */
  target: Box | null;
  fallback: Box;
  reduced: boolean;
  /** At 650 ms: the moment the game should cheer. */
  onCheer(): void;
}

/** Plays the come-alive flight; resolves when it is over (900 ms, or 200 ms reduced). */
export async function flyComeAlive(o: ComeAliveOptions): Promise<void> {
  const root = layer();
  const { img, aspect } = await imageAspect(o.sticker);
  const plan = planFlight(o.from, o.target ?? o.fallback, aspect);
  img.className = 'flight__sticker';
  Object.assign(img.style, { left: `${plan.to.x}px`, top: `${plan.to.y}px`, width: `${plan.to.w}px`, height: `${plan.to.h}px` });
  root.append(img);
  try {
    if (o.reduced) {
      await wait(img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SETTLE_MS, easing: 'linear', fill: 'forwards' }));
      o.onCheer();
      return;
    }
    const sx = plan.from.w / plan.to.w;
    const sy = plan.from.h / plan.to.h;
    const s0 = Math.min(sx, sy);
    const x0 = plan.from.x + plan.from.w / 2 - (plan.to.x + plan.to.w / 2);
    const y0 = plan.from.y + plan.from.h / 2 - (plan.to.y + plan.to.h / 2);
    const fly = img.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(${s0})`, offset: 0 },
        { transform: `translate(${x0 * 0.45}px, ${y0 * 0.45 - plan.lift}px) scale(${(s0 + 1.06) / 2})`, offset: 0.5 },
        { transform: 'translate(0, 0) scale(1.06)', offset: 1 },
      ],
      { duration: FLY_MS, easing: EASE_AMBLE, fill: 'forwards' },
    );
    await wait(fly);
    const settle = img.animate(
      [
        { transform: 'scale(1.06)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: SETTLE_MS, easing: EASE_POP, fill: 'forwards' },
    );
    await wait(settle);
    o.onCheer();
    sparks(root, plan.to);
    await sleep(ALIVE_MS - FLY_MS - SETTLE_MS);
  } finally {
    img.remove();
  }
}

/** Eight mint sparks drifting up from the feet (CSS only). */
function sparks(root: HTMLElement, at: Box): void {
  const feetX = at.x + at.w / 2;
  const feetY = at.y + at.h;
  for (let i = 0; i < SPARKS; i++) {
    const s = document.createElement('span');
    s.className = 'flight__spark';
    const spread = (i / (SPARKS - 1) - 0.5) * Math.max(40, at.w * 0.9);
    s.style.left = `${feetX + spread}px`;
    s.style.top = `${feetY - 6}px`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}px`);
    s.style.setProperty('--dy', `${-40 - Math.random() * 50}px`);
    s.style.animationDelay = `${i * 18}ms`;
    root.append(s);
    s.addEventListener('animationend', () => s.remove(), { once: true });
    setTimeout(() => s.remove(), 1500);
  }
}

export interface LiftOptions {
  /** The member's box on the page. */
  from: Box;
  /** Where the Desk sheet will roughly be (page px). */
  to: Box;
  reduced: boolean;
  /** A picture for the card (the member's "just bones" glyph or sticker), optional. */
  art?: Node | null;
}

/**
 * Grows a sheet from the member to the Desk sheet, with the member's picture on it; resolves with the card
 * once it has grown (null under reduced motion). The caller removes the card inside the View Transition
 * that changes the route, so the card's `desk-sheet` name passes to the Desk's sheet.
 */
export async function liftCard(o: LiftOptions): Promise<HTMLElement | null> {
  if (o.reduced) return null;
  const root = layer();
  const card = document.createElement('div');
  card.className = 'flight__lift';
  if (o.art) card.append(o.art);
  Object.assign(card.style, { left: `${o.to.x}px`, top: `${o.to.y}px`, width: `${o.to.w}px`, height: `${o.to.h}px` });
  card.style.setProperty('view-transition-name', DESK_SHEET_TRANSITION);
  root.append(card);
  const sx = Math.max(0.05, o.from.w / o.to.w);
  const sy = Math.max(0.05, o.from.h / o.to.h);
  const dx = o.from.x - o.to.x;
  const dy = o.from.y - o.to.y;
  await wait(
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.4, transformOrigin: '0 0' },
        { transform: 'translate(0, 0) scale(1, 1)', opacity: 1, transformOrigin: '0 0' },
      ],
      { duration: LIFT_MS, easing: EASE_LIFT, fill: 'forwards' },
    ),
  );
  // Never left behind, whatever happens to the route change.
  setTimeout(() => card.remove(), 2000);
  return card;
}
