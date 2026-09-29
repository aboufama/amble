/**
 * Keeping the drawing safe while the Desk is open (§4.4, §7.6): a draft 1 s after each change (only the
 * cels not saved yet), and a commit of the drawing at checkpoints: 20 s after the last change, when the page
 * is hidden (a closed lid), and when the Desk closes. A new drawing with no ink is never saved. A failed
 * save says so once and offers Save to Drive; drawing goes on (drafts and the stroke log still work).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilesApi } from '../../files/api';
import type { DeskController } from '../../draw/deskController';
import { saveDrawing, writeDraft } from '../../draw/drafts';
import type { DeskSetup } from '../../draw/load';
import { t } from '../../i18n';
import type { ArtRecord, BlobRef } from '../../model/types';
import type { Store } from '../../store/api';
import { showToast } from '../../state/app';
import { setDraw } from '../../state/draw';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

const DRAFT_MS = 1000;
const IDLE_MS = 20_000;

/** Saves still running when the Desk closed: the next Desk waits for them before it opens a drawing. */
const pending = new Set<Promise<unknown>>();

export function savesSettled(): Promise<void> {
  return Promise.allSettled([...pending]).then(() => undefined);
}

function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  void p.finally(() => pending.delete(p)).catch(() => undefined);
  return p;
}

export interface DeskSaving {
  status: SaveStatus;
  /** The saved record (after a checkpoint, or Bring to life). */
  record(): ArtRecord | null;
  /** Bring to life committed the drawing itself. */
  broughtToLife(record: ArtRecord): void;
  /** Commits now (Ctrl+S). */
  saveNow(): Promise<void>;
}

/** What the drawing is called now (the student can name a free drawing). */
export type NameOf = () => string;

export function useDeskSaving(ctrl: DeskController | null, setup: DeskSetup, store: Store, files: FilesApi, nameOf: NameOf): DeskSaving {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const record = useRef<ArtRecord | null>(setup.record);
  const saved = useRef<Set<BlobRef>>(new Set(setup.saved));
  const changed = useRef(false);
  const draftTimer = useRef(0);
  const idleTimer = useRef(0);
  const failedOnce = useRef(false);
  const busy = useRef<Promise<void> | null>(null);

  const context = useCallback(
    () => ({ artId: setup.artId, worldId: setup.world?.id ?? null, castKey: setup.request.key, saved: saved.current }),
    [setup],
  );

  const failed = useCallback(
    (err: unknown) => {
      console.warn('The drawing could not be saved:', err);
      setStatus('failed');
      if (failedOnce.current) return;
      failedOnce.current = true;
      showToast(t('draw.saveFailed'), {
        kind: 'error',
        action: { label: t('draw.saveToDrive'), run: () => void files.saveDrawing(setup.artId).catch(() => showToast(t('draw.saveFailed'), { kind: 'error' })) },
      });
    },
    [files, setup.artId],
  );

  /** The commit itself (one at a time). */
  const commit = useCallback(
    async (c: DeskController): Promise<void> => {
      if (!changed.current) return;
      const s = c.getSnapshot();
      if (!s.ready || (s.inked === 0 && !record.current)) return;
      changed.current = false;
      setStatus('saving');
      const r = c.request;
      try {
        const doc = await c.surface.doc();
        doc.name = nameOf();
        const rec = await saveDrawing(store, {
          doc,
          artId: setup.artId,
          previous: record.current,
          name: nameOf(),
          kind: r.kind,
          rig: r.rig,
          role: r.role,
          facing: r.facing,
          mode: s.mode,
          parts: s.parts,
          shelf: setup.world === null,
        });
        record.current = rec;
        saved.current = new Set(rec.cels);
        c.surface.markSaved();
        setStatus('saved');
        setDraw({ dirty: false });
      } catch (err) {
        changed.current = true;
        failed(err);
      }
    },
    [failed, setup, store, nameOf],
  );

  const checkpoint = useCallback(
    (c: DeskController): Promise<void> => {
      clearTimeout(idleTimer.current);
      const run = (busy.current ?? Promise.resolve()).then(() => commit(c));
      busy.current = run;
      return track(run);
    },
    [commit],
  );

  const draft = useCallback(
    async (c: DeskController) => {
      const s = c.getSnapshot();
      if (!s.ready || (s.inked === 0 && !record.current)) return;
      try {
        await writeDraft(store, await c.surface.doc(), context(), s.tool);
      } catch (err) {
        console.warn('The draft could not be written:', err);
      }
    },
    [context, store],
  );

  // A change: a draft soon, a checkpoint after 20 s of quiet.
  useEffect(() => {
    if (!ctrl) return;
    const onChange = () => {
      changed.current = true;
      setDraw({ dirty: true });
      if (status !== 'failed') setStatus('idle');
      clearTimeout(draftTimer.current);
      draftTimer.current = window.setTimeout(() => void track(draft(ctrl)), DRAFT_MS);
      clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => void checkpoint(ctrl), IDLE_MS);
    };
    const offPen = ctrl.onEvent((e) => {
      if (e.type === 'penup') onChange();
    });
    const offHistory = ctrl.surface.on('history', () => {
      if (ctrl.getSnapshot().ready) onChange();
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void checkpoint(ctrl);
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      offPen();
      offHistory();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      clearTimeout(draftTimer.current);
      clearTimeout(idleTimer.current);
    };
    // `status` only decides the word shown; the handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, checkpoint, draft]);

  return {
    status,
    record: () => record.current,
    broughtToLife: (rec) => {
      record.current = rec;
      saved.current = new Set(rec.cels);
      changed.current = false;
      clearTimeout(draftTimer.current);
      clearTimeout(idleTimer.current);
      setStatus('saved');
    },
    saveNow: () => (ctrl ? checkpoint(ctrl) : Promise.resolve()),
  };
}

/**
 * The checkpoint as the Desk closes: takes the drawing from the surface before it goes away (the save runs
 * on after the screen has changed; the next Desk waits for it).
 */
export function saveOnClose(ctrl: DeskController, saving: DeskSaving, setup: DeskSetup, store: Store, name: string): void {
  const s = ctrl.getSnapshot();
  if (!s.ready || !s.dirty || (s.inked === 0 && !saving.record())) return;
  const r = ctrl.request;
  const doc = ctrl.surface.doc();
  track(
    doc
      .then((d) => {
        d.name = name;
        return saveDrawing(store, {
          doc: d,
          artId: setup.artId,
          previous: saving.record(),
          name,
          kind: r.kind,
          rig: r.rig,
          role: r.role,
          facing: r.facing,
          mode: s.mode,
          parts: s.parts,
          shelf: setup.world === null,
        });
      })
      .catch((err: unknown) => console.warn('The drawing could not be saved on the way out:', err)),
  );
}
