/**
 * The Trail's data (§2.4), pure and framework-free: what Home shows first, which worlds stand on the
 * trail and in what order, Lost and found expiry, "Edited 2 days ago", and the trail's geometry (the
 * path, the hills the signs stand on, where each stop goes, and room for the walkers).
 */
import type { ArtId, ArtRecordLite, Assignment, Prefs, StarterId, StarterInfo, WorldId, WorldMeta } from '../model/types';

export const DAY_MS = 86_400_000;
/** Put-away worlds wait this long in Lost and found (§1.5 law 4). */
export const LOST_DAYS = 30;

// ------------------------------------------------------------------ Home: the First page or the Trail

export type HomeChoice = 'loading' | 'first' | 'trail';

export interface LibraryView {
  loaded: boolean;
  worlds: WorldMeta[];
  characters: ArtRecordLite[];
}

/** First launch (no worlds, no drawings, the First page never finished) shows the First page. */
export function homeChoice(lib: LibraryView, seen: Prefs['seen']): HomeChoice {
  if (!lib.loaded) return 'loading';
  const hasWorlds = lib.worlds.some((w) => w.putAwayAt === null);
  return !hasWorlds && lib.characters.length === 0 && !seen.firstPage ? 'first' : 'trail';
}

// ------------------------------------------------------------------ worlds on the trail and in Lost and found

/** Worlds standing on the trail: not put away, most recently opened first. */
export function trailWorlds(metas: readonly WorldMeta[]): WorldMeta[] {
  return metas.filter((m) => m.putAwayAt === null).sort((a, b) => b.openedAt - a.openedAt || b.updatedAt - a.updatedAt);
}

export type WorldSort = 'recent' | 'name';

/** The List view's order: Recent (last opened) or Name (A to Z, then the most recent). */
export function sortWorlds(metas: readonly WorldMeta[], by: WorldSort): WorldMeta[] {
  const live = trailWorlds(metas);
  if (by === 'recent') return live;
  return live.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) || b.openedAt - a.openedAt);
}

/** Whole days a put-away world has left (0 once 30 days have passed). */
export function daysLeft(putAwayAt: number, now: number): number {
  const left = LOST_DAYS - Math.floor(Math.max(0, now - putAwayAt) / DAY_MS);
  return Math.max(0, Math.min(LOST_DAYS, left));
}

export function isExpired(putAwayAt: number, now: number): boolean {
  return daysLeft(putAwayAt, now) === 0;
}

export interface LostWorld {
  meta: WorldMeta;
  daysLeft: number;
}

/** Lost and found: put-away worlds still inside their 30 days, most recently put away first. */
export function lostWorlds(metas: readonly WorldMeta[], now: number): LostWorld[] {
  return metas
    .filter((m): m is WorldMeta & { putAwayAt: number } => m.putAwayAt !== null && !isExpired(m.putAwayAt, now))
    .sort((a, b) => b.putAwayAt - a.putAwayAt)
    .map((meta) => ({ meta, daysLeft: daysLeft(meta.putAwayAt, now) }));
}

/** Put-away worlds whose 30 days are over (purged when Lost and found is opened). */
export function expiredWorlds(metas: readonly WorldMeta[], now: number): WorldId[] {
  return metas.filter((m) => m.putAwayAt !== null && isExpired(m.putAwayAt, now)).map((m) => m.id);
}

// ------------------------------------------------------------------ "Edited 2 days ago"

export type EditedText =
  | { key: 'editedNow' | 'editedOneMinute' | 'editedOneHour' | 'editedYesterday' }
  | { key: 'editedMinutes' | 'editedHours' | 'editedDays'; n: number }
  | { key: 'editedDate'; date: string };

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** When a world was last changed, in words a nine-year-old reads at a glance. */
export function editedText(at: number, now: number): EditedText {
  const ms = Math.max(0, now - at);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return { key: 'editedNow' };
  if (min === 1) return { key: 'editedOneMinute' };
  if (min < 60) return { key: 'editedMinutes', n: min };
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) {
    const hours = Math.floor(min / 60);
    return hours === 1 ? { key: 'editedOneHour' } : { key: 'editedHours', n: hours };
  }
  if (days === 1) return { key: 'editedYesterday' };
  if (days < 14) return { key: 'editedDays', n: days };
  return { key: 'editedDate', date: new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) };
}

// ------------------------------------------------------------------ characters

/** The newest drawing (it stands under the lamppost). */
export function latestCharacter(chars: readonly ArtRecordLite[]): ArtRecordLite | null {
  let best: ArtRecordLite | null = null;
  for (const c of chars) if (!best || c.updatedAt > best.updatedAt) best = c;
  return best;
}

/** Drawings no world on the trail uses ("resting"): they walk near the + New world signpost. */
export function restingCharacters(chars: readonly ArtRecordLite[], metas: readonly WorldMeta[]): ArtRecordLite[] {
  const used = new Set<ArtId>();
  for (const m of metas) {
    if (m.putAwayAt !== null) continue;
    if (m.hero) used.add(m.hero);
    for (const w of m.walkers) used.add(w);
  }
  return chars.filter((c) => !used.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** An assignment from the class link that has no world yet (its note hangs from the lamppost). */
export function pendingAssignment(asg: Assignment | null, metas: readonly WorldMeta[]): Assignment | null {
  if (!asg) return null;
  const started = metas.some((m) => m.origin === 'assignment' && m.assignment?.title === asg.title);
  return started ? null : asg;
}

// ------------------------------------------------------------------ stops along the trail

export type Stop =
  | { kind: 'newWorld'; id: 'new-world'; resting: ArtId[] }
  | { kind: 'lamp'; id: 'lamp' }
  | { kind: 'world'; id: WorldId; meta: WorldMeta }
  | { kind: 'signpost'; id: 'starters' }
  | { kind: 'starter'; id: StarterId; info: StarterInfo };

export interface StopsInput {
  worlds: readonly WorldMeta[];
  starters: readonly StarterInfo[];
  hasCharacters: boolean;
  resting: ArtId[];
}

/**
 * The trail from left to right. The student's worlds come first (most recently opened on the left),
 * then a small **Starter worlds** signpost (only when there are worlds of their own), then the starters.
 * With no characters the lamppost's empty spot stands third, as in the mockup; returning students get
 * the **+ New world** signpost (with the resting characters) and the lamppost (their newest character) first.
 */
export function trailStops(o: StopsInput): Stop[] {
  const worlds: Stop[] = trailWorlds(o.worlds).map((meta) => ({ kind: 'world', id: meta.id, meta }));
  const starters: Stop[] = o.starters.filter((s) => !s.hidden && s.id !== 'parade').map((info) => ({ kind: 'starter', id: info.id as StarterId, info }));
  const signpost: Stop[] = worlds.length ? [{ kind: 'signpost', id: 'starters' }] : [];
  const lamp: Stop = { kind: 'lamp', id: 'lamp' };
  if (o.hasCharacters) {
    return [{ kind: 'newWorld', id: 'new-world', resting: o.resting }, lamp, ...worlds, ...signpost, ...starters];
  }
  const seq = [...worlds, ...signpost, ...starters];
  seq.splice(Math.min(2, seq.length), 0, lamp);
  return seq;
}

/** Signs a student can open (for roving focus): worlds and starters, in trail order. */
export function signStops(stops: readonly Stop[]): Array<Extract<Stop, { kind: 'world' | 'starter' }>> {
  return stops.filter((s): s is Extract<Stop, { kind: 'world' | 'starter' }> => s.kind === 'world' || s.kind === 'starter');
}

// ------------------------------------------------------------------ geometry (design px at 1366x768)

/** The design height the trail's y values are written for; screens anchor them to the bottom edge. */
export const DESIGN_H = 768;
export const FIRST_X = 92;
export const SIGN_W = 170;
/** A sign's board (its picture, name and "Edited 2 days ago") at 100 % text; the Trail measures the real one. */
export const BOARD_H = 138;
export const LEG_H = 34;

/** Walkers stand in the path, their feet this far below its upper edge, and are this tall. */
export const WALKER_FOOT = 20;
export const WALKER_H = 58;
/** Smaller than this, a walker would be a smudge: it stays home instead. */
export const MIN_WALKER_H = 36;
/** The longest stroll a walker takes (there and back, px), and the space kept above walkers' heads. */
export const STROLL_MAX = 130;
export const SIGN_CLEAR = 8;

/** Slot widths along the trail. */
export const STOP_W: Record<Stop['kind'], number> = { newWorld: 190, lamp: 380, world: 250, signpost: 150, starter: 250 };

/** The path's upper edge, hand-traced from the mockup (x ≤ 1400), then gently rolling on. */
const PATH_POINTS: Array<[number, number]> = [
  [-30, 752],
  [120, 713],
  [250, 704],
  [400, 698],
  [560, 692],
  [720, 681],
  [860, 674],
  [1080, 656],
  [1290, 638],
  [1400, 634],
];

function lerpPoints(points: Array<[number, number]>, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      const t = (x - x0) / (x1 - x0);
      // Smoothstep between hand-placed points keeps the curve soft without overshoot.
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return points[points.length - 1][1];
}

/** The path's upper edge at content x (design px). */
export function pathTop(x: number): number {
  if (x <= 1400) return lerpPoints(PATH_POINTS, x);
  return 634 + 11 * (1 - Math.cos((x - 1400) / 280));
}

/** The path's thickness at x: wide at the near (left) end, narrower far away. */
export function pathWidth(x: number): number {
  return x < 400 ? 48 - (x + 30) * (18 / 430) : 30;
}

/** The ground's upper edge (where the signs' legs stand): just behind the path, a little higher far away. */
export function groundTop(x: number): number {
  const far = Math.max(0, Math.min(1, (x - 300) / 1000));
  return pathTop(x) - 34 - 18 * far;
}

/** A small, fixed variety in how tall each sign stands, so the row looks placed by hand. */
const SIGN_WOBBLE = [0, -8, 4, -5, 7, -3];

export interface PlacedStop {
  stop: Stop;
  x: number;
  width: number;
  /** Centre x of the slot's sign or feature. */
  cx: number;
}

/** Lays the stops out left to right from `FIRST_X`, with extra room before the lamp for an assignment note. */
export function placeStops(stops: readonly Stop[], o: { noteRoom?: number } = {}): { placed: PlacedStop[]; width: number } {
  let x = FIRST_X;
  const placed: PlacedStop[] = [];
  for (const stop of stops) {
    if (stop.kind === 'lamp' && o.noteRoom) x += o.noteRoom;
    const width = STOP_W[stop.kind];
    const cx = stop.kind === 'world' || stop.kind === 'starter' ? x + SIGN_W / 2 : stop.kind === 'lamp' ? x + 128 : x + width / 2 - 20;
    placed.push({ stop, x, width, cx });
    x += width;
  }
  return { placed, width: x + FIRST_X };
}

/** The feet line of the walkers in front of a sign at `cx`, at its highest (they stroll sideways only). */
function walkerFeetLine(cx: number): number {
  return Math.min(walkerFeet(cx, 0).y, walkerFeet(cx, 1).y);
}

/**
 * A sign's board top (design px): legs standing on the ground, the board clear of the heads of the
 * walkers in front of it (their names stay readable), and never higher than `minTop` (the hero copy must
 * stay readable when the trail scrolls under it). When the hero copy pushes a sign that low, its walkers
 * shrink to fit under it (`walkerRoom`).
 */
export function signTop(cx: number, index: number, minTop: number, boardH = BOARD_H): number {
  const standing = Math.round(groundTop(cx) + 3 - LEG_H - boardH + SIGN_WOBBLE[index % SIGN_WOBBLE.length]);
  const clear = Math.floor(walkerFeetLine(cx) - WALKER_H - SIGN_CLEAR - boardH);
  return Math.max(minTop, Math.min(standing, clear));
}

/** How long a sign's legs are, from its board down to the ground (at least 10 px). */
export function legHeight(cx: number, top: number, boardH = BOARD_H): number {
  return Math.max(10, Math.round(groundTop(cx) + 3 - (top + boardH)));
}

/**
 * How tall the walkers in front of a sign may be, so they never cross its board: `WALKER_H` when there
 * is room, less when the sign stands low, 0 (they stay home) when not even `MIN_WALKER_H` fits.
 */
export function walkerRoom(cx: number, top: number, boardH = BOARD_H): number {
  const room = Math.floor(walkerFeetLine(cx) - SIGN_CLEAR - (top + boardH));
  return room >= MIN_WALKER_H ? Math.min(WALKER_H, room) : 0;
}

/** A smooth SVG path through points (Catmull-Rom to cubic Béziers). */
export function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

function walkerX(cx: number, slot: number): number {
  return cx + (slot === 0 ? 70 : -80);
}

/** Where walkers stand under a stop: feet in the path, right and left of the stop's centre. */
export function walkerFeet(cx: number, slot: number): { x: number; y: number } {
  const x = walkerX(cx, slot);
  return { x, y: Math.round(pathTop(x) + WALKER_FOOT) };
}
