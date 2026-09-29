/**
 * The guide overlay the UI can set on the paper: a faint silhouette or pose image, a size reference
 * ("Pip, for size"), a ground line and the anchor pin. Display only: guides never export.
 */
import type { Rect } from './geom';

export type GuideImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface GuideItem {
  image: GuideImage;
  /** Where it sits on the board, board px. */
  box: { x: number; y: number; w: number; h: number };
  /** 0..1 (default 0.25). */
  opacity?: number;
  /** Recolour the image's shape (e.g. pencil blue '#6f8fd8'); omit to keep its colours. */
  tint?: string;
  /** Small caption under it, e.g. "Pip, for size". */
  label?: string;
}

export interface Guide {
  /** The silhouette or pose to draw over. */
  silhouette?: GuideItem | null;
  /** Another drawing at the right relative scale. */
  sizeRef?: GuideItem | null;
  /** The ground line's y, board px. */
  groundY?: number | null;
  /** Label on the ground line (default "ground"). */
  groundLabel?: string;
  /** Show the anchor pin (the surface's anchor, or the automatic one). */
  showAnchor?: boolean;
  /** Draw above the drawing instead of just above the paper. */
  onTop?: boolean;
  /** Line and label colour (default a soft pencil blue). */
  color?: string;
  /** A picture drawn over the drawing, whatever `onTop` says (the bones to draw on, their labels). */
  above?: GuideItem | null;
}

const DEFAULT_COLOR = '#6f8fd8';

/** Renders the guide into a board-sized canvas context (cleared first). Returns the drawn area. */
export function drawGuide(ctx: OffscreenCanvasRenderingContext2D, W: number, H: number, g: Guide, anchor: [number, number] | null): Rect | null {
  ctx.clearRect(0, 0, W, H);
  const color = g.color ?? DEFAULT_COLOR;
  const unit = Math.max(W, H) / 1024;
  const item = (it: GuideItem | null | undefined): void => {
    if (!it) return;
    const { x, y, w, h } = it.box;
    ctx.save();
    ctx.globalAlpha = it.opacity ?? 0.25;
    if (it.tint) {
      // Tint through a scratch canvas: the image's alpha, the tint's colour.
      const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      const t = c.getContext('2d');
      if (t) {
        t.drawImage(it.image, 0, 0, c.width, c.height);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = it.tint;
        t.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(c, x, y, w, h);
      }
    } else ctx.drawImage(it.image, x, y, w, h);
    ctx.restore();
    if (it.label) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.font = `${Math.round(16 * unit)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(it.label, x + w / 2, y + h + 6 * unit);
      ctx.restore();
    }
  };
  item(g.sizeRef);
  item(g.silhouette);
  if (g.groundY !== undefined && g.groundY !== null) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2 * unit;
    ctx.setLineDash([10 * unit, 8 * unit]);
    ctx.beginPath();
    ctx.moveTo(W * 0.04, g.groundY);
    ctx.lineTo(W * 0.96, g.groundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(14 * unit)}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText((g.groundLabel ?? 'ground').toUpperCase(), W * 0.96, g.groundY + 6 * unit);
    ctx.restore();
  }
  if (g.showAnchor && anchor) {
    const [ax, ay] = anchor;
    const r = 9 * unit;
    ctx.save();
    ctx.fillStyle = '#ff6b4a';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * unit;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax - r * 1.1, ay - r * 1.4, ax - r * 1.1, ay - r * 2.6, ax, ay - r * 2.6);
    ctx.bezierCurveTo(ax + r * 1.1, ay - r * 2.6, ax + r * 1.1, ay - r * 1.4, ax, ay);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(ax, ay - r * 1.75, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return { x0: 0, y0: 0, x1: W, y1: H };
}
