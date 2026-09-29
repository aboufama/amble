/**
 * FOUNDATION-STUB screen body: the route's title as the page heading and `data-testid="screen-<name>"`.
 * Every module replaces its stubs with the real screen.
 */
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { routeTitleKey, type Route } from '../routes';
import { ScreenFrame } from './ScreenFrame';
import { TopBar } from './TopBar';

export interface ScreenStubProps {
  route: Route;
  /** `screen-<name>`. */
  name: string;
  /** Shown instead of the route's title. */
  title?: string;
  topBar?: boolean;
  children?: ReactNode;
}

export function ScreenStub({ route, name, title, topBar = true, children }: ScreenStubProps) {
  const heading = title ?? t(routeTitleKey(route));
  return (
    <ScreenFrame testId={`screen-${name}`} header={topBar ? <TopBar /> : undefined} className="screen--stub">
      <div className="stub">
        <h1 className="stub__title">{heading}</h1>
        {children}
      </div>
    </ScreenFrame>
  );
}
