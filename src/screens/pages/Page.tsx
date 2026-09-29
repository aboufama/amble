/**
 * `#/privacy`, `#/terms`, `#/ai`, `#/it`, `#/parents`, `#/accessibility`, `#/poster`, `#/sent`,
 * `#/whatsnew`: the in-app pages (§2.15; M7 owns). FOUNDATION-STUB: each page's title.
 */
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';

export function Page({ route }: { route: RouteOf<'page'> }) {
  return (
    <div data-page={route.page} className="page-host">
      <ScreenStub route={route} name="page" />
    </div>
  );
}
