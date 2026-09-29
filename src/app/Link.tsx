/**
 * A link to a route: a real `<a href="#/...">` (so it opens in a new tab and reads as a link), with
 * same-tab clicks going through `navigate()` for the screen transition.
 */
import type { ComponentProps, MouseEvent } from 'react';
import { hrefOf, navigate } from './router';
import type { Route } from './routes';

export interface LinkProps extends Omit<ComponentProps<'a'>, 'href'> {
  to: Route;
  replace?: boolean;
}

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={hrefOf(to)} onClick={go} {...rest}>
      {children}
    </a>
  );
}
