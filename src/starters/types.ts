/**
 * The starter worlds' data shapes: what each starter declares (meta.ts), and the `art.json` the build tool
 * writes next to each drawing's files in `public/starters/<id>/art/<key>/` (read by `open()`).
 */
import type { ArtScript } from '../cores/art';
import type { ArtExport, ArtKind, BlobRef, CastKey, Facing, PartLayers, RigData, RigKind, Role, SeedId } from '../model/types';

/** How a cast member starts in the starter world (the seed has only the student's hero drawn). */
export type CastState = 'drawn' | 'yourTurn' | 'spare' | 'bones';

/** One cast member of a starter, as its `static art` declares it, plus where its drawing comes from. */
export interface StarterCast {
  key: CastKey;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  role: Role;
  facing: Facing;
  state: CastState;
  /** The ArtScript's name (drawn members only). */
  script?: string;
}

/** A starter world's definition (src/starters/<id>/meta.ts). */
export interface StarterMeta {
  id: SeedId;
  /** Its strings in src/i18n/en/starters.ts: `<ns>Title`, `<ns>Genre`, `<ns>Blurb`, `staff_<ns>Teaches`. */
  ns: 'moonKing' | 'skyRun' | 'wobbleTower' | 'lanternMaze' | 'clanksClimb' | 'parade';
  heroKey: CastKey;
  yourTurn: CastKey | null;
  spare: CastKey[];
  /** Words for the ladder's idea match (§9). */
  tags: string[];
  cast: StarterCast[];
  /** The game's files: helpers first (alphabetical), `game.js` last. */
  files: Array<{ path: string; source: string }>;
  /** "Watch it drawn": the ArtScripts of the drawn members, loaded on demand. */
  scripts: Partial<Record<CastKey, () => Promise<ArtScript>>>;
}

/** `public/starters/<id>/art/<key>/art.json`: a drawing ready to store (ids and times are added by open()). */
export interface StarterArtJson {
  v: 1;
  key: CastKey;
  script: string;
  name: string;
  kind: ArtKind;
  rig: RigKind;
  facing: Facing;
  role: Role | null;
  mode: 'bones' | 'free';
  board: { w: number; h: number; pixelArt: boolean };
  doc: BlobRef;
  cels: BlobRef[];
  parts: Record<string, PartLayers>;
  export: ArtExport;
  rigData: RigData | null;
  rigInfo: { made: 'auto' | 'guide' | 'parts' | 'ai' | 'hand'; confidence: number; notes: string[] } | null;
  palette: string[];
  /** Every blob this drawing needs, by content address, as paths relative to the art.json. */
  files: Record<BlobRef, string>;
}
