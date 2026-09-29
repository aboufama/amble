/** `#/w/<id>/handin` Hand in (§2.13; M7 owns): a sheet over the world. FOUNDATION-STUB. */
import { navigate } from '../../app/router';
import type { RouteOf } from '../../app/routes';
import { t } from '../../i18n';
import { Sheet } from '../../ui/components';

export function HandInSheet({ route }: { route: RouteOf<'handin'> }) {
  return (
    <Sheet open title={t('common.routeHandin')} onClose={() => navigate({ name: 'world', id: route.worldId })}>
      <div data-testid="screen-handin" className="stub">
        <p className="dialog__text">{t('school.handinStub')}</p>
      </div>
    </Sheet>
  );
}
