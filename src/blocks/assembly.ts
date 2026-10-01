import * as Blockly from 'blockly/core';
import { FieldAmbleText } from './fields';

/**
 * Words being built show on their blocks, quietly: the block goes pale, like a plan of itself, and
 * bricks of its colour settle into it from left to right while the build runs, quickly at first and
 * then slower, so a long build never looks finished. When the build lands, the last bricks drop in and
 * the block settles, solid again. Under reduced motion the block only stays pale while it builds.
 * The CSS is in styles.css (`.amble-assembly`).
 */

const SVG = 'http://www.w3.org/2000/svg';

type Building = { targetId: string; words: string };

interface Overlay {
  g: SVGGElement;
  /** Each brick, and when it lands (ms after `since`). */
  bricks: Array<{ el: SVGRectElement; at: number; anim: Animation | null }>;
  since: number;
}

/** The overlays shown now, by block id. */
const shown = new WeakMap<Blockly.WorkspaceSvg, Map<string, Overlay>>();
/** When each of the words being built started building (so bricks carry on after switching sprites). */
const startedAt = new Map<string, number>();
let clips = 0;

/** Most bricks land within the first seconds; the last few wait for the build itself. */
const PACE = 4200;
const BEFORE_LANDING = 0.88;
const BRICK_MS = 360;
const DROP: Keyframe[] = [
  { opacity: 0, transform: 'translateY(-4px) scale(0.85)' },
  { opacity: 1, transform: 'none' },
];
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function wordsOf(block: Blockly.Block): string[] {
  const words: string[] = [];
  for (const input of block.inputList) for (const field of input.fieldRow) if (field instanceof FieldAmbleText) words.push(String(field.getValue() ?? '').trim());
  return words;
}

/** A rough random in [0, 1) from a number, so the bricks of a block land in the same order each time. */
function jitter(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function addOverlay(block: Blockly.BlockSvg, since: number): Overlay | null {
  const root = block.getSvgRoot();
  const path = root.querySelector(':scope > .blocklyPath');
  const d = path?.getAttribute('d');
  if (!path || !d) return null;
  const g = document.createElementNS(SVG, 'g');
  g.setAttribute('class', 'amble-assembly');
  // The block's own shape, pale: what it will be.
  const plan = document.createElementNS(SVG, 'path');
  plan.setAttribute('class', 'amble-assembly-plan');
  plan.setAttribute('d', d);
  g.append(plan);
  const overlay: Overlay = { g, bricks: [], since };
  if (!reducedMotion()) {
    // Bricks of its colour, kept to its shape.
    const clip = document.createElementNS(SVG, 'clipPath');
    clip.id = `amble-assembly-${++clips}`;
    const shape = document.createElementNS(SVG, 'path');
    shape.setAttribute('d', d);
    clip.append(shape);
    g.append(clip);
    const bricks = document.createElementNS(SVG, 'g');
    bricks.setAttribute('clip-path', `url(#${clip.id})`);
    g.append(bricks);
    // Bricks, laid like a wall: every other row is offset by half a brick.
    const width = block.width;
    const height = block.height;
    const gap = 2;
    const rows = Math.max(1, Math.round(height / 22));
    const cols = Math.max(3, Math.round(width / 26));
    const w = (width - gap * (cols - 1)) / cols;
    const h = (height - gap * (rows - 1)) / rows;
    const colour = block.getColour();
    const order: Array<{ x: number; y: number; w: number; key: number }> = [];
    for (let r = 0; r < rows; r++) {
      const shift = r % 2 ? (w + gap) / 2 : 0;
      for (let c = -1; c < cols; c++) {
        const x = c * (w + gap) + shift;
        const left = Math.max(0, x);
        const right = Math.min(width, x + w);
        if (right - left < 2) continue;
        order.push({ x: left, y: r * (h + gap), w: right - left, key: left / (w + gap) + jitter(c * 31 + r) * 1.4 });
      }
    }
    order.sort((a, b) => a.key - b.key);
    const now = performance.now() - since;
    order.forEach((cell, k) => {
      const el = document.createElementNS(SVG, 'rect');
      el.setAttribute('class', 'amble-brick');
      el.setAttribute('x', cell.x.toFixed(1));
      el.setAttribute('y', cell.y.toFixed(1));
      el.setAttribute('width', cell.w.toFixed(1));
      el.setAttribute('height', h.toFixed(1));
      el.setAttribute('rx', '3');
      el.setAttribute('fill', colour);
      bricks.append(el);
      const share = k / order.length;
      const at = share < BEFORE_LANDING ? -PACE * Math.log(1 - share) : Infinity;
      const anim = Number.isFinite(at) ? el.animate(DROP, { duration: BRICK_MS, delay: at - now, easing: EASE, fill: 'both' }) : null;
      if (!anim) el.style.opacity = '0';
      overlay.bricks.push({ el, at, anim });
    });
  }
  path.after(g);
  root.classList.add('amble-building');
  return overlay;
}

function removeOverlay(ws: Blockly.WorkspaceSvg, id: string, overlay: Overlay, landed: boolean): void {
  const block = ws.getBlockById(id) as Blockly.BlockSvg | null;
  const root = block?.getSvgRoot();
  const done = () => {
    overlay.g.remove();
    root?.classList.remove('amble-building');
  };
  if (!landed || !root || !overlay.g.isConnected || reducedMotion()) {
    done();
    return;
  }
  // The last bricks drop in, the gaps close, and the block settles.
  const now = performance.now() - overlay.since;
  const waiting = overlay.bricks.filter((t) => !(t.at <= now));
  waiting.forEach((t, i) => {
    t.anim?.cancel();
    t.el.style.opacity = '';
    t.anim = t.el.animate(DROP, { duration: BRICK_MS, delay: (i * 260) / Math.max(1, waiting.length), easing: EASE, fill: 'both' });
  });
  const close = waiting.length ? 260 + BRICK_MS : 0;
  window.setTimeout(() => {
    overlay.g.classList.add('amble-assembly-done');
    root.classList.add('amble-snap');
    window.setTimeout(done, 220);
    window.setTimeout(() => root.classList.remove('amble-snap'), 700);
  }, close);
}

/**
 * Shows the words of `targetId` that are being built (`building`) assembling on their blocks, and lets
 * them settle into place when the build is done (`landed`).
 */
export function syncAssembly(ws: Blockly.WorkspaceSvg, targetId: string | null, building: readonly Building[], landed: boolean): void {
  let overlays = shown.get(ws);
  if (!overlays) shown.set(ws, (overlays = new Map()));
  const now = performance.now();
  const keys = new Set(building.map((b) => `${b.targetId}\n${b.words.trim()}`));
  for (const key of startedAt.keys()) if (!keys.has(key)) startedAt.delete(key);
  for (const key of keys) if (!startedAt.has(key)) startedAt.set(key, now);
  const words = new Map(building.filter((b) => b.targetId === targetId).map((b) => [b.words.trim(), startedAt.get(`${b.targetId}\n${b.words.trim()}`) ?? now]));
  const wanted = new Map<string, number>();
  if (words.size) {
    for (const block of ws.getAllBlocks(false)) {
      const since = wordsOf(block).find((w) => words.has(w));
      if (since !== undefined) wanted.set(block.id, words.get(since)!);
    }
  }
  for (const [id, overlay] of overlays) {
    if (wanted.has(id) && overlay.g.isConnected) continue;
    removeOverlay(ws, id, overlay, landed);
    overlays.delete(id);
  }
  for (const [id, since] of wanted) {
    if (overlays.has(id)) continue;
    const block = ws.getBlockById(id) as Blockly.BlockSvg | null;
    const overlay = block ? addOverlay(block, since) : null;
    if (overlay) overlays.set(id, overlay);
  }
}
