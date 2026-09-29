/**
 * Opens a starter as a new world (§9): the starter world with its example drawings (all but its "your turn"
 * member and its spares), or a seed ("Give Blorp a world") where only the student's hero is drawn. The
 * drawings are the files the build tool committed in `public/starters/<id>/art/<key>/`: fetched from the
 * app's own origin (never replayed), so a starter opens in well under a second. A drawing that cannot be
 * fetched plays as just bones: the world always opens.
 */
import { t } from '../i18n';
import { uid } from '../model/ids';
import type { ArtId, ArtRecord, CastKey, CastSlot, CodeFile, Level, SeedId, StepSummary, World } from '../model/types';
import { infoOf, metaOf, starterPath } from './catalog';
import type { StarterArtJson, StarterMeta } from './types';

export interface OpenDeps {
  /** Reads one of the app's own files (a relative URL). */
  fetchFile(path: string): Promise<Blob>;
  level(): Level;
  now(): number;
}

export interface Opened {
  world: World;
  art: ArtRecord[];
  blobs: Blob[];
}

/** Which cast members start drawn. */
export function drawnKeys(meta: StarterMeta, o: { withArt: boolean; hero?: ArtId }): CastKey[] {
  if (!o.withArt) return [];
  return meta.cast.filter((c) => c.state === 'drawn' && !(o.hero && c.key === meta.heroKey)).map((c) => c.key);
}

/** A starter's code as world files: every line written by the starter. */
export function starterCode(meta: StarterMeta): CodeFile[] {
  return meta.files.map((f) => ({ path: f.path, source: f.source, authors: [['starter', f.source.split('\n').length]], locked: [] }));
}

async function loadArt(meta: StarterMeta, key: CastKey, deps: OpenDeps): Promise<{ record: ArtRecord; blobs: Blob[] } | null> {
  const dir = starterPath(meta.id, `art/${key}/`);
  try {
    const json = JSON.parse(await (await deps.fetchFile(dir + 'art.json')).text()) as StarterArtJson;
    const blobs = await Promise.all(Object.values(json.files).map((path) => deps.fetchFile(dir + path)));
    const now = deps.now();
    const record: ArtRecord = {
      id: uid('a_'),
      name: json.name,
      kind: json.kind,
      rig: json.rig,
      facing: json.facing,
      role: json.role,
      mode: json.mode,
      board: json.board,
      doc: json.doc,
      cels: json.cels,
      parts: json.parts,
      export: json.export,
      rigData: json.rigData,
      rigInfo: json.rigInfo,
      palette: json.palette,
      madeBy: 'example',
      shelf: false,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    return { record, blobs };
  } catch {
    // Offline before the files were ever cached, or a damaged file: this member plays as just bones.
    return null;
  }
}

export async function openStarter(id: SeedId, o: { withArt: boolean; hero?: ArtId }, deps: OpenDeps): Promise<Opened> {
  const meta = metaOf(id);
  const info = infoOf(meta);
  const loaded = await Promise.all(drawnKeys(meta, o).map(async (key) => [key, await loadArt(meta, key, deps)] as const));
  const cast: Record<CastKey, CastSlot> = {};
  for (const c of meta.cast) cast[c.key] = { key: c.key, art: null, madeBy: null, extra: null, laterUntil: 0 };
  const art: ArtRecord[] = [];
  const blobs: Blob[] = [];
  for (const [key, got] of loaded) {
    if (!got) continue;
    cast[key] = { ...cast[key], art: got.record.id, madeBy: 'example' };
    art.push(got.record);
    blobs.push(...got.blobs);
  }
  if (o.hero) cast[meta.heroKey] = { ...cast[meta.heroKey], key: meta.heroKey, art: o.hero, madeBy: 'student' };
  const now = deps.now();
  const step: StepSummary = { id: uid('s_'), at: now, by: 'student', kind: 'start', text: t('starters.stepStarted', { title: info.title }) };
  const world: World = {
    format: 'amble-world',
    version: 1,
    id: uid('w_'),
    title: info.title,
    pitch: '',
    level: deps.level(),
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    origin: meta.id === 'parade' ? { kind: 'parade' } : { kind: 'starter', starter: meta.id, withArt: o.withArt },
    code: starterCode(meta),
    cast,
    sounds: {},
    dials: {},
    twists: [],
    controls: {},
    gameStorage: {},
    steps: [step],
    head: step.id,
    assignment: null,
    handIn: { fileName: null, savedAt: null, method: null, turnedInAt: null },
    credits: { madeBy: '' },
    plan: null,
  };
  return { world, art, blobs };
}
