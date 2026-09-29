/** Small hooks the world screen shares: drawings' stickers, the world view's rect, the layout class. */
import { useEffect, useState, type RefObject } from 'react';
import { useServices } from '../../app/services';
import type { ArtId, ArtRecord } from '../../model/types';
import { useStore } from '../../state/store';

/** The art record of a drawing (null while it loads, or when there is none). */
export function useArtRecord(artId: ArtId | null): ArtRecord | null {
  const { store } = useServices();
  const [record, setRecord] = useState<ArtRecord | null>(null);
  useEffect(() => {
    let live = true;
    if (!artId) {
      setRecord(null);
      return;
    }
    void store.art
      .get(artId)
      .then((r) => {
        if (live) setRecord(r);
      })
      .catch(() => undefined);
    const off = store.onChange((e) => {
      if (!e.art?.includes(artId)) return;
      void store.art.get(artId).then((r) => {
        if (live) setRecord(r);
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [artId, store]);
  return record;
}

/** The object URL of a drawing's sticker (its die-cut edge baked in). */
export function useSticker(artId: ArtId | null): string | null {
  const { store } = useServices();
  const record = useArtRecord(artId);
  const ref = record?.export?.sticker ?? record?.export?.thumb ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!ref) {
      setUrl(null);
      return;
    }
    void store.blobs
      .url(ref)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ref, store]);
  return url;
}

/** An element's page rect, kept current (resize, layout changes, scrolling in portrait). `ready` re-reads the ref. */
export function useRect(ref: RefObject<HTMLElement | null>, ready = true): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [ref, ready]);
  return rect;
}

export function useLayout() {
  return useStore((s) => s.app.layout);
}
