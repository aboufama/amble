/** `#/new` the New world sheet (§2.5; M1 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function NewWorldSheet({ route }: { route: RouteOf<'new'> }) {
  return <ScreenStub route={route} name="new" />;
}
