/**
 * `usePlayerSlot(slotId, ref)`: a screen marks where the running game should appear. The PlayerLayer's
 * iframe is positioned over the element while it is mounted (and visible).
 */
import { useEffect, type RefObject } from 'react';
import { useServices } from '../services';
import type { SlotId } from './host';

export type { SlotId } from './host';

export function usePlayerSlot(slot: SlotId, ref: RefObject<HTMLElement | null>, active = true): void {
  const { player } = useServices();
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    return player.attach(slot, el);
  }, [player, slot, ref, active]);
}
