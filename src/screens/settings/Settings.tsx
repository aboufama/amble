/** `#/settings[/<section>]` Settings (§2.15; M7 owns). FOUNDATION-STUB. */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function Settings({ route }: { route: RouteOf<'settings'> }) {
  return <ScreenStub route={route} name="settings" />;
}
