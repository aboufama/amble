/**
 * Layout classes (§2.2) from the usable viewport, set as `<html data-layout>` and `app.layout`.
 * full ≥ 1340×740 · tab ≥ 1280×620 · touch: coarse pointer and ≥ 1280×680 · small < 1280 wide or < 620
 * high · portrait: taller than wide.
 */
import type { LayoutClass } from '../state/store';
import { setLayout } from '../state/app';

export function layoutFor(width: number, height: number, coarse: boolean): LayoutClass {
  if (height > width) return 'portrait';
  if (width < 1280 || height < 620) return 'small';
  if (coarse && height >= 680) return 'touch';
  if (width >= 1340 && height >= 740) return 'full';
  return 'tab';
}

/** Keeps the layout class current; returns a function that stops watching. */
export function watchLayout(win: Window = window): () => void {
  const coarse = win.matchMedia('(pointer: coarse)');
  const update = () => {
    const layout = layoutFor(win.innerWidth, win.innerHeight, coarse.matches);
    win.document.documentElement.dataset.layout = layout;
    setLayout(layout);
  };
  update();
  win.addEventListener('resize', update);
  coarse.addEventListener('change', update);
  return () => {
    win.removeEventListener('resize', update);
    coarse.removeEventListener('change', update);
  };
}
