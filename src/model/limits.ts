/**
 * Budgets (SPEC §4.8) and the length limits written next to the §4.2 types. One place, so the validator,
 * the Desk, storage and the tests agree.
 */

const KB = 1024;
const MB = 1024 * 1024;

/** §4.8. */
export const LIMITS = {
  /** World JSON (the `worlds` record). */
  worldJsonBytes: 200 * KB,
  codeFiles: 8,
  codeFileLines: 400,
  codeFileBytes: 40 * KB,
  codeTotalBytes: 120 * KB,
  /** Declared art keys in `static art`. */
  castKeys: 16,
  dials: 8,
  sounds: 32,
  /** One world's blobs: warn, then refuse new drawings ("This world is very big..."). */
  worldBlobsWarnBytes: 40 * MB,
  worldBlobsRefuseBytes: 60 * MB,
  /** A drawing's board, long side (backgrounds up to 1920x1080). */
  boardMaxSide: 2048,
  backgroundWidth: 1920,
  backgroundHeight: 1080,
  layers: 12,
  layersOnTheBones: 16,
  frames: 24,
  /** The Desk's estimated memory: layers at 4 MB per 1024², undo ≤ 128 MB. */
  deskMemoryBytes: 250 * MB,
  deskLayerBytesPer1024: 4 * MB,
  deskUndoBytes: 128 * MB,
  /** Decoded textures per game. */
  gameTextureBytes: 32 * MB,
  /** Biggest `.amble` file Amble opens, and its entry count. */
  ambleFileBytes: 60 * MB,
  ambleFileEntries: 2000,
  /** Warn when storage use passes this share of `navigator.storage.estimate().quota`. */
  storageWarnRatio: 0.8,
} as const;

/** Lengths and counts from the comments in §4.2 and §4.3-4.6. */
export const TEXT_LIMITS = {
  worldTitle: 40,
  worldPitch: 300,
  madeBy: 20,
  artName: 40,
  assignmentTitle: 60,
  assignmentText: 400,
  className: 40,
  classLinkBytes: 2 * KB,
  planTitle: 28,
  planPitch: 140,
  planAsk: 60,
  planAbout: 80,
  planControls: 5,
  planCastMin: 1,
  planCastMax: 8,
  planBuildsMin: 2,
  planBuildsMax: 4,
  planDialsMin: 3,
  planDialsMax: 6,
  palette: 24,
  castKey: 24,
} as const;

export const KEEP = {
  /** Game localStorage kept per world. */
  gameStorageBytes: 64 * KB,
  /** Footsteps snapshots per world before older ones fold to one per day. */
  stepsPerWorld: 60,
  /** Snapshots written into a `.amble` file. */
  stepsInFile: 20,
  /** "What Amble sends". */
  aiLogEntries: 50,
  /** Lost and found. */
  lostAndFoundDays: 30,
  /** Unreferenced blobs older than this are collected. */
  blobGraceMs: 24 * 60 * 60 * 1000,
} as const;
