/** `#/w/<id>/draw/<key>` and `#/draw/<artId|new>` the Desk (§2.10; M3 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function Desk({ route }: { route: RouteOf<'draw'> | RouteOf<'drawFree'> }) {
  return <ScreenStub route={route} name="draw" />;
}
