/** `#/w/<id>/bones/<key>` and `#/bones/<artId>` Bones (§2.11; M4 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function Bones({ route }: { route: RouteOf<'bones'> | RouteOf<'bonesFree'> }) {
  return <ScreenStub route={route} name="bones" />;
}
