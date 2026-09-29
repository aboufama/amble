/**
 * `#/w/<id>` the world (§2.6; M2 owns). FOUNDATION-STUB with the basic plumbing M2 builds on: it opens the
 * world, registers the `world` player slot and loads the game into it.
 */
import { useEffect, useRef } from 'react';
import { isSupersededLoad } from '../../app/player/host';
import { playerPrefsFrom } from '../../app/player/prefs';
import { usePlayerSlot } from '../../app/player/slots';
import { ScreenFrame } from '../../app/frame/ScreenFrame';
import { TopBar } from '../../app/frame/TopBar';
import type { RouteOf } from '../../app/routes';
import { useServices } from '../../app/services';
import { t } from '../../i18n';
import { openWorld } from '../../state/session';
import { getState, setState, useStore } from '../../state/store';
import { toInitMessage } from '../../world/init';

export function World({ route }: { route: RouteOf<'world'> }) {
  const { player } = useServices();
  const slot = useRef<HTMLDivElement>(null);
  const world = useStore((s) => (s.session.world?.id === route.id ? s.session.world : null));
  usePlayerSlot('world', slot);

  useEffect(() => {
    let live = true;
    void (async () => {
      const opened = await openWorld(route.id);
      if (!live || !opened) return;
      player.setTitle(`${opened.title} (game)`);
      const manifest = await player.load(await toInitMessage(opened, { mode: 'play', prefs: playerPrefsFrom(getState().prefs) }));
      if (!live) return;
      setState((s) => {
        s.session.manifest = manifest;
      });
    })().catch((err: unknown) => {
      // Leaving the world, or a newer load, cancels this one; M2 shows real failures in the problem card.
      if (!isSupersededLoad(err)) console.error('The world could not start:', err);
    });
    return () => {
      live = false;
    };
  }, [route.id, player]);

  return (
    <ScreenFrame testId="screen-world" header={<TopBar title={world?.title ?? t('common.routeWorld')} />}>
      <div ref={slot} id="game" className="stub-world-view" tabIndex={-1} aria-label={world?.title ?? t('common.routeWorld')} data-testid="world-slot" />
    </ScreenFrame>
  );
}
