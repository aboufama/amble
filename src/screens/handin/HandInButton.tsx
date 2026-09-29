/**
 * **Hand in** in the world's top bar (§2.6, §2.13; used by M2 when the world has an assignment). After
 * "I turned it in" it reads **Handed in ✓ 10:44** and still opens the sheet (saving again updates the file).
 */
import { Link } from '../../app/Link';
import { t } from '../../i18n';
import type { World } from '../../model/types';
import { Icon } from '../../ui/icons';

export function HandInButton({ world }: { world: World }) {
  const at = world.handIn.turnedInAt;
  if (at) {
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
    return (
      <Link to={{ name: 'handin', worldId: world.id }} className="btn btn--ghost btn--h44" data-testid="handin-button">
        <Icon name="check" size={20} />
        <span className="btn__label">{t('school.handedInButton', { time })}</span>
      </Link>
    );
  }
  return (
    <Link to={{ name: 'handin', worldId: world.id }} className="btn btn--lantern btn--h44" data-testid="handin-button">
      <Icon name="handIn" size={20} />
      <span className="btn__label">{t('common.routeHandin')}</span>
    </Link>
  );
}
