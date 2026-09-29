/**
 * **Hand in** in the world's top bar (§2.6; M7 owns, used by M2 when the world has an assignment).
 * FOUNDATION-STUB: opens the Hand in route.
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import type { World } from '../../model/types';
import { Icon } from '../../ui/icons';

export function HandInButton({ world }: { world: World }) {
  return (
    <Link to={{ name: 'handin', worldId: world.id }} className="btn btn--lantern btn--h44">
      <Icon name="handIn" size={20} />
      <span className="btn__label">{t('common.routeHandin')}</span>
    </Link>
  );
}
