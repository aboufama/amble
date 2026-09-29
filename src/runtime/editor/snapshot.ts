/**
 * A PNG of the current frame (the Trail sign, the Loading picture): the shell draws a frame, and in the
 * same task, before the browser presents and clears the WebGL drawing buffer, the canvas is copied into a
 * smaller one. Works paused or running, with WebGL or Canvas.
 */
import type Phaser from 'phaser';

export function snapshotPng(game: Phaser.Game, render: () => void, maxW: number): Promise<Blob | null> {
  const src = game.canvas;
  if (!src || !src.width || !src.height) return Promise.resolve(null);
  const scale = Math.min(1, maxW / src.width);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  render();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), 'image/png'));
}
