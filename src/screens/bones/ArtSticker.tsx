/**
 * The drawing in the sky with its cream die-cut edge and soft shadow (§1.1: drawings wear a sticker
 * edge wherever they appear). Baked into a canvas once per size and theme: the same look as CSS
 * drop-shadow filters, which a weak Chromebook would re-run on every repaint while a star is dragged.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { PAPER, THEMES, type ThemeName } from '../../ui/tokens';

export interface ArtStickerProps {
  url: string;
  /** Where and how big the drawing shows, css px in the sky. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room around the drawing for the edge and the shadow, css px. */
const PAD = 30;
const EDGE = 2.5;

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function ArtSticker({ url, left, top, width, height }: ArtStickerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useStore((s) => s.prefs.theme) as ThemeName;

  useEffect(() => {
    const c = canvas.current;
    if (!c || width < 1 || height < 1) return;
    let live = true;
    const img = new Image();
    img.src = url;
    void img.decode().then(
      () => {
        if (!live) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.ceil((width + 2 * PAD) * dpr);
        const H = Math.ceil((height + 2 * PAD) * dpr);
        const x = PAD * dpr, y = PAD * dpr, w = width * dpr, h = height * dpr;
        // the drawing's silhouette in paper colour
        const sil = document.createElement('canvas');
        sil.width = W;
        sil.height = H;
        const s = sil.getContext('2d');
        const ctx = c.getContext('2d');
        if (!s || !ctx) return;
        s.imageSmoothingQuality = 'high';
        s.drawImage(img, x, y, w, h);
        s.globalCompositeOperation = 'source-in';
        s.fillStyle = PAPER.paper;
        s.fillRect(0, 0, W, H);
        c.width = W;
        c.height = H;
        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.shadowColor = withAlpha((THEMES[theme] ?? THEMES.night).bgDeep, 0.7);
        ctx.shadowBlur = 18 * dpr;
        ctx.shadowOffsetY = 10 * dpr;
        ctx.drawImage(sil, 0, 0);
        ctx.restore();
        // the edge: the silhouette stamped around a small circle
        const r = EDGE * dpr;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, x, y, w, h);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [url, width, height, theme]);

  return (
    <canvas
      ref={canvas}
      className="bones-sky__art"
      style={{ left: left - PAD, top: top - PAD, width: width + 2 * PAD, height: height + 2 * PAD }}
      aria-hidden="true"
    />
  );
}
