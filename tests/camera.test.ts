import { describe, expect, it } from 'vitest';
import { cameraSetup } from '../src/engine/camera';

/** Where Phaser draws world point p (one axis) for an object with scroll factor f. */
const phaser = (p: number, f: number, c: { scroll: number; zoom: number; origin: number }) => c.zoom * (p - f * c.scroll - c.origin) + c.origin;

/** Where it belongs: the picture a 480 x 360 camera would draw, times the canvas scale. */
const wanted = (p: number, f: number, half: number, scale: number, zoom: number, scroll: number) => scale * (zoom * (p - f * scroll - half) + half);

describe('the camera at any canvas scale', () => {
  // 0.5 = the small stage, 1 = the normal one, 2 = a Retina display, 2.4 = full screen, 6 = full screen on Retina.
  const scales = [0.5, 1, 1.5, 2, 2.4, 6];
  const zooms = [1, 2, 0.5, 1.3];
  const factors = [1, 0, 0.3]; // scrolls with the camera, pinned to the screen (HUD, backgrounds), parallax

  it('draws pinned, parallax and scrolling things where a 480 x 360 canvas would, scaled', () => {
    for (const scale of scales) {
      for (const zoom of zooms) {
        for (const [x, y] of [[0, 0], [130, -40], [-900, 250]]) {
          const c = cameraSetup(scale, zoom, x, y);
          for (const f of factors) {
            for (const p of [0, 240, 480, 1234]) {
              const gotX = phaser(p, f, { scroll: c.scrollX, zoom: c.zoom, origin: c.originX });
              const gotY = phaser(p, f, { scroll: c.scrollY, zoom: c.zoom, origin: c.originY });
              // (A hair of zoom, 0.05%, is added when scale x zoom is exactly 1: about a pixel, far off screen.)
              const slack = Math.abs(scale * zoom - 1) < 1e-3 && zoom !== 1 ? 1.5 : 0.001;
              expect(Math.abs(gotX - wanted(p, f, 240, scale, zoom, x)), `x scale ${scale} zoom ${zoom} f ${f} p ${p}`).toBeLessThan(slack);
              expect(Math.abs(gotY - wanted(p, f, 180, scale, zoom, -y)), `y scale ${scale} zoom ${zoom} f ${f} p ${p}`).toBeLessThan(slack);
            }
          }
        }
      }
    }
  });

  it('keeps a screen-pinned background filling the canvas (what broke in full screen and on Retina)', () => {
    for (const scale of scales) {
      const c = cameraSetup(scale, 1, 300, 50);
      // A 480-wide rectangle pinned to the screen covers the canvas exactly, wherever the camera looks.
      expect(phaser(0, 0, { scroll: c.scrollX, zoom: c.zoom, origin: c.originX })).toBeCloseTo(0, 6);
      expect(phaser(480, 0, { scroll: c.scrollX, zoom: c.zoom, origin: c.originX })).toBeCloseTo(480 * scale, 6);
      expect(phaser(360, 0, { scroll: c.scrollY, zoom: c.zoom, origin: c.originY })).toBeCloseTo(360 * scale, 6);
    }
  });

  it('centers what the camera looks at', () => {
    const c = cameraSetup(2, 1, 100, 60);
    // Stage point (100, 60) is world (340, 120): the middle of a 960 x 720 canvas.
    expect(phaser(340, 1, { scroll: c.scrollX, zoom: c.zoom, origin: c.originX })).toBeCloseTo(480, 6);
    expect(phaser(120, 1, { scroll: c.scrollY, zoom: c.zoom, origin: c.originY })).toBeCloseTo(360, 6);
  });
});
