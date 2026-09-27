import { useEffect, type ReactNode } from 'react';
import { BackIcon } from './icons';

export interface LibraryItem {
  id: string;
  name: string;
  image: ReactNode;
  /** Sounds play while the pointer is over them, like Scratch's sound library. */
  onHover?(): void;
  onLeave?(): void;
}

/** Scratch's full-screen library ("Choose a Sound"...): a purple header with Back, then a grid of tiles. */
export function Library({ title, items, onChoose, onClose }: { title: string; items: LibraryItem[]; onChoose(id: string): void; onClose(): void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="library-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="library-header">
        <button className="library-back" onClick={onClose}>
          <BackIcon size={20} /> Back
        </button>
        <div className="library-title">{title}</div>
      </div>
      <div className="library-grid">
        {items.map((item) => (
          <button
            key={item.id}
            className="library-item"
            onMouseEnter={item.onHover}
            onMouseLeave={item.onLeave}
            onClick={() => {
              item.onLeave?.();
              onChoose(item.id);
            }}
          >
            <div className="library-item-image">{item.image}</div>
            <span className="library-item-name">{item.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
