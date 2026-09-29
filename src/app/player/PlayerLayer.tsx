/**
 * The fixed layer at the app root that holds the game iframes (§6.4). `PlayerHost` positions it over the
 * registered slot; the iframe is never moved in the DOM, because moving it would reload the game.
 */
import { useEffect, useRef } from 'react';
import { useServices } from '../services';

interface LayerHost {
  mountLayer(el: HTMLElement): () => void;
}

function isLayerHost(v: unknown): v is LayerHost {
  return typeof v === 'object' && v !== null && typeof (v as LayerHost).mountLayer === 'function';
}

export function PlayerLayer() {
  const { player } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !isLayerHost(player)) return;
    return player.mountLayer(el);
  }, [player]);
  return <div ref={ref} className="player-layer" data-testid="player-layer" data-slot="none" />;
}
