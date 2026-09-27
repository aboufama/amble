import { useEffect, useRef, useState } from 'react';

interface Drag {
  from: number;
  to: number;
}

/**
 * Drag tiles to reorder a list, like Scratch's sprite, costume and sound lists: the tile
 * follows the pointer and the others make room. Tiles carry `data-reorder`; a drag starts
 * after the pointer moves a few pixels, so clicks still select.
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (index: number) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest('button, input')) return;
    const tile = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    const tiles = [...(containerRef.current?.querySelectorAll<HTMLElement>('[data-reorder]') ?? [])];
    let rects: DOMRect[] = [];
    let ghost: HTMLElement | null = null;
    let offset = { x: 0, y: 0 };
    let current: Drag | null = null;

    const move = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        rects = tiles.map((t) => t.getBoundingClientRect());
        // Like Scratch, the tile's picture follows the pointer in a small card.
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        const picture = tile.querySelector('.tile-image > *');
        if (picture) ghost.appendChild(picture.cloneNode(true));
        document.body.appendChild(ghost);
        document.body.classList.add('reordering');
        const box = ghost.getBoundingClientRect();
        offset = { x: box.width / 2, y: box.height / 2 };
      }
      ghost.style.transform = `translate(${ev.clientX - offset.x}px, ${ev.clientY - offset.y}px)`;
      let to = index;
      let best = Infinity;
      rects.forEach((r, i) => {
        const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (d < best) {
          best = d;
          to = i;
        }
      });
      if (!current || current.to !== to) {
        current = { from: index, to };
        setDrag(current);
      }
    };
    const end = () => {
      cleanup.current?.();
      if (current && current.to !== current.from) onMove(current.from, current.to);
      setDrag(null);
    };
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      ghost?.remove();
      document.body.classList.remove('reordering');
      cleanup.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** The list's indices in display order (the dragged item shown where it would land). */
  const order = (count: number): number[] => {
    const list = Array.from({ length: count }, (_, i) => i);
    if (!drag) return list;
    list.splice(drag.from, 1);
    list.splice(drag.to, 0, drag.from);
    return list;
  };

  return { containerRef, drag, order, onPointerDown };
}

/** Moves one item of a list (for use inside an immer update). */
export function moveItem<T>(list: T[], from: number, to: number): void {
  const [item] = list.splice(from, 1);
  if (item !== undefined) list.splice(to, 0, item);
}
