/**
 * **More tools** before Bring it to life (§2.3): the First page's drawing is kept as a drawing of the
 * student's (not yet alive: no export, no bones) so the full Desk can open it at `#/draw/<artId>`. The
 * stroke log stays on this device, like every drawing's.
 */
import { getServices } from '../../app/services';
import { serializeArtDoc, type ArtDoc } from '../../cores/art';
import { uid } from '../../model/ids';
import type { ArtId, ArtRecord } from '../../model/types';
import { refreshLibrary } from '../../state/library';

export async function keepDoodle(doc: ArtDoc, name: string): Promise<ArtId> {
  const { store } = getServices();
  const serialized = await serializeArtDoc({ ...doc, name });
  const now = Date.now();
  const record: ArtRecord = {
    id: uid('a_'),
    name,
    kind: 'character',
    rig: 'blob',
    facing: 'viewer',
    role: null,
    mode: 'free',
    board: { w: doc.width, h: doc.height, pixelArt: doc.pixelArt },
    doc: serialized.docRef,
    cels: serialized.cels.map((c) => c.ref),
    parts: {},
    export: null,
    rigData: null,
    rigInfo: null,
    palette: doc.palette.slice(0, 24),
    madeBy: 'student',
    shelf: true,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
  await store.commit({ blobs: [serialized.docBlob, ...serialized.cels.map((c) => c.blob)], art: [record] });
  if (serialized.strokeLog) await store.strokes.append(record.id, new Uint8Array(await serialized.strokeLog.arrayBuffer())).catch(() => undefined);
  void refreshLibrary(store);
  return record.id;
}
