/**
 * Surfaces (§3.3, §3.4): the night `Panel`, and paper that means "yours": `PaperCard` (tape, a small
 * tilt, the hand-cut radius) and `StickyNote` (the request note's sticky paper).
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

export function PaperCard({ tape = 'none', tilt = 0, cut = false, as: Tag = 'div', className, children, labelledBy }: PaperCardProps) {
  const angle = Math.max(-1.5, Math.min(1.5, tilt));
  return (
    <Tag className={cx('paper', 'on-paper', cut && 'paper--cut', className)} style={angle ? { rotate: `${angle}deg` } : undefined} aria-labelledby={labelledBy}>
      {(tape === 'lemon' || tape === 'both') && <span className="tape tape--lemon" aria-hidden="true" />}
      {(tape === 'lime' || tape === 'both') && <span className="tape tape--lime" aria-hidden="true" />}
      {children}
    </Tag>
  );
}

export function StickyNote({ children, tilt = -2.5, className }: { children?: ReactNode; tilt?: number; className?: string }) {
  return (
    <div className={cx('sticky-note', 'on-paper', className)} style={{ rotate: `${tilt}deg` }}>
      <span className="tape tape--lemon" aria-hidden="true" />
      {children}
    </div>
  );
}
