/** `#/w/<id>/code[/<file>]` Look inside (§2.12; M9 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function CodeView({ route }: { route: RouteOf<'code'> }) {
  return <ScreenStub route={route} name="code" />;
}
