/**
 * A screen's landmarks (§3.9): the header (top bar), `main` (the skip link's target, focused after a
 * route change) and an optional complementary region. Screens with their own layout keep `id="main"` on
 * their main region, and `id="game"` on the world view when there is one.
 */
import type { ReactNode } from 'react';
import { cx } from '../../ui/cx';

export interface ScreenFrameProps {
  header?: ReactNode;
  aside?: ReactNode;
  asideLabel?: string;
  /** `data-testid` of the screen (`screen-<name>`). */
  testId: string;
  className?: string;
  children?: ReactNode;
}

export function ScreenFrame({ header, aside, asideLabel, testId, className, children }: ScreenFrameProps) {
  return (
    <div className={cx('screen', className)} data-testid={testId}>
      {header}
      <main id="main" tabIndex={-1} className="screen__main">
        {children}
      </main>
      {aside && (
        <aside className="screen__aside" aria-label={asideLabel}>
          {aside}
        </aside>
      )}
    </div>
  );
}
