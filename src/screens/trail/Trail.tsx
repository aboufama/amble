/** `#/trail` the Trail, its List view and Lost and found (§2.4; M1 owns). FOUNDATION-STUB. */
import { Link } from '../../app/Link';
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';

export function Trail({ route }: { route: RouteOf<'trail'> }) {
  const { starters } = useServices();
  return (
    <ScreenStub route={route} name="trail">
      <ul className="stub__links">
        {starters.list().map((s) => (
          <li key={s.id}>
            <Link to={{ name: 'starter', id: s.id === 'parade' ? 'moon-king' : s.id }}>{s.title}</Link>
          </li>
        ))}
      </ul>
    </ScreenStub>
  );
}
