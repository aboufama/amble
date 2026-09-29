/**
 * Surfaces: the `Panel`, and paper that means "yours": `PaperCard` and `StickyNote` (the request note's
 * sticky paper). Both are flat, square to the page and untaped, like Scratch's cards and comment notes;
 * `tape`, `tilt` and `cut` are accepted for older callers and ignored.
 */
import { useId, type ReactNode } from 'react';
import { cx } from '../cx';

export interface PanelProps {
  title?: ReactNode;
  headingLevel?: 2 | 3;
  /** Right side of the panel header (a badge, a link). */
  actions?: ReactNode;
  as?: 'section' | 'div' | 'aside';
  className?: string;
  children?: ReactNode;
}

export function Panel({ title, headingLevel = 2, actions, as: Tag = 'section', className, children }: PanelProps) {
  const id = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Tag className={cx('panel', className)} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className="panel__head">
          {title && (
            <Heading id={id} className="panel__title">
              {title}
            </Heading>
          )}
          {actions && <div className="panel__actions">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

export type Tape = 'lemon' | 'lime' | 'both' | 'none';

export interface PaperCardProps {
  /** Only on paper that "came from someone" (the first page, teacher notes, request notes). */
  tape?: Tape;
  /** Degrees, -1.5 to 1.5. */
  tilt?: number;
  /** The hand-cut radius (sparingly: tags and notes). */
  cut?: boolean;
  as?: 'div' | 'section' | 'article' | 'aside';
  className?: string;
  children?: ReactNode;
  labelledBy?: string;
}

export function PaperCard({ as: Tag = 'div', className, children, labelledBy }: PaperCardProps) {
  return (
    <Tag className={cx('paper', 'on-paper', className)} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}

export function StickyNote({ children, className }: { children?: ReactNode; tilt?: number; className?: string }) {
  return <div className={cx('sticky-note', 'on-paper', className)}>{children}</div>;
}
