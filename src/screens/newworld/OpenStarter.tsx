/**
 * `#/starter/<id>` (§2.1; M1 routing, M8 content): opens a starter world as the student's own copy and
 * goes to it (replacing this route in history). FOUNDATION-STUB with the basic flow; M1 adds "keep the
 * copy only once the student changes something".
 */
import { useEffect } from 'react';
import { navigate } from '../../app/router';
import { ScreenStub } from '../../app/frame/ScreenStub';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';

export function OpenStarter({ route }: { route: RouteOf<'starter'> }) {
  const { starters, store } = useServices();
  useEffect(() => {
    let live = true;
    void (async () => {
      const { world, art, blobs } = await starters.open(route.id, { withArt: true });
      // StrictMode runs this effect twice in dev: only the live run keeps its copy.
      if (!live) return;
      await store.commit({ blobs, art, worlds: [world] });
      if (live) navigate({ name: 'world', id: world.id }, { replace: true, transition: false });
    })();
    return () => {
      live = false;
    };
  }, [route.id, starters, store]);
  return <ScreenStub route={route} name="starter" />;
}
