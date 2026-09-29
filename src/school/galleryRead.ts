/**
 * The gallery's light read (§2.14): a card needs the manifest, the thumbnail, `world.json` and the drawing
 * records, never the pictures, sounds or footstep snapshots, so a 5 MB file is never fully decoded for the
 * grid. Student files are untrusted: every part goes through M6's validators (the same ones `read()` uses),
 * and a world only plays from a full `files.read()` when the teacher opens it.
 */
import { strFromU8, unzipSync } from 'fflate';
import { isZip, tooBig } from '../files/amble';
import { FileProblem } from '../files/problem';
import { checkBlob, checkManifest, cleanArtRecord, cleanWorld, entryName } from '../files/validate';
import { t } from '../i18n';
import { LIMITS } from '../model/limits';
import type { AmbleManifest, ArtRecord, World } from '../model/types';

export interface CardRead {
  manifest: AmbleManifest;
  /** null for a drawing file (a gallery of worlds skips it). */
  world: World | null;
  art: ArtRecord[];
  thumb: Blob | null;
}

function parse(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

const damaged = () => new FileProblem('damaged', t('files.notAmble'));

/** Reads what a gallery card shows. Throws `FileProblem` like `files.read()` does. */
export async function readForCard(file: Blob): Promise<CardRead> {
  if (file.size > LIMITS.ambleFileBytes) throw tooBig(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) throw new FileProblem('not-amble', t('files.notAmble'));

  let count = 0;
  let total = 0;
  let unsafe = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (info) => {
        if (++count > LIMITS.ambleFileEntries) throw damaged();
        const e = entryName(info.name);
        if (e.kind === 'unsafe') {
          unsafe = true;
          return false;
        }
        if (e.kind !== 'manifest' && e.kind !== 'thumb' && e.kind !== 'world' && e.kind !== 'art') return false;
        total += info.originalSize;
        if (total > LIMITS.ambleFileBytes) throw tooBig(total);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof FileProblem) throw err;
    throw damaged();
  }
  if (unsafe) throw damaged();

  const checked = checkManifest(parse(entries['manifest.json']));
  if (!checked.ok) throw new FileProblem(checked.kind, checked.kind === 'newer' ? t('files.newer') : t('files.notAmble'));
  const manifest = checked.manifest;

  const thumbBytes = entries['thumb.png'];
  const thumb = thumbBytes && checkBlob('png', thumbBytes).ok ? new Blob([thumbBytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null;

  let world: World | null = null;
  if (manifest.kind !== 'drawing') {
    world = cleanWorld(parse(entries['world.json']));
    if (!world) throw damaged();
  }

  const art: ArtRecord[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const e = entryName(name);
    if (e.kind !== 'art') continue;
    const record = cleanArtRecord(parse(data));
    if (record && record.id === e.id) art.push(record);
  }
  return { manifest, world, art, thumb };
}
