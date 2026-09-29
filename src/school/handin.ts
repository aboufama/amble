/**
 * Hand in (§2.13): checking a world against its goals (with a fresh 6-second robot test in the spare
 * player), saving it to Drive under the student's initials, and recording "I turned it in". Changes to the
 * world are committed to the store and, when the world is open, written into the session so the world
 * screen's copy (and its autosave) carries them.
 */
import { getServices } from '../app/services';
import { playerPrefsFrom } from '../app/player/prefs';
import type { GameManifest } from '../cores/play';
import type { ArtId, World, WorldId } from '../model/types';
import { getState, setState } from '../state/store';
import { toInitMessage } from '../world/init';
import { castFromCode, type CastInfo } from './assignment';
import { goalsFor, runChecks, type ArtFacts, type CheckOutcome, type RobotRun } from './checks';
import { codeFacts } from './codeFacts';
import { buildStory, type Story } from './story';

export const ROBOT_SECONDS = 6;
const ROBOT_WALL_MS = 25_000;

/** The world, from the open session when it is this one, else the store. */
export async function loadWorld(id: WorldId): Promise<World | null> {
  const open = getState().session.world;
  if (open?.id === id) return open;
  return getServices().store.worlds.get(id);
}

/** Saves a changed world (one commit) and keeps the open session's copy in step. */
export async function commitWorld(next: World): Promise<World> {
  await getServices().store.commit({ worlds: [next] });
  if (getState().session.world?.id === next.id) {
    setState((s) => {
      s.session.world = next;
    });
  }
  return next;
}

/** The cast as the running game reports it, else as `static art` declares it. */
export function castOf(world: World, manifest: GameManifest | null): CastInfo[] {
  if (manifest?.art.length) return manifest.art.map((a) => ({ key: a.key, name: a.name, role: a.role, required: a.required }));
  return castFromCode(world.code);
}

/** Who made each of the world's drawings (from the art records). */
export async function artFactsOf(world: World): Promise<Map<ArtId, ArtFacts>> {
  const store = getServices().store;
  const out = new Map<ArtId, ArtFacts>();
  for (const slot of Object.values(world.cast)) {
    if (!slot.art || out.has(slot.art)) continue;
    const record = await store.art.get(slot.art).catch(() => null);
    if (record) out.set(record.id, { madeBy: record.madeBy, onBones: record.mode === 'bones' || record.rigInfo?.made === 'parts' });
  }
  return out;
}

/** A fresh robot test in the spare player (the visible game keeps playing). Null when it can't run. */
export async function robotRun(world: World, seconds = ROBOT_SECONDS): Promise<RobotRun> {
  const { player } = getServices();
  try {
    const init = await toInitMessage(world, {
      mode: 'robot',
      prefs: { ...playerPrefsFrom(getState().prefs), muted: true },
      robot: { gameMs: seconds * 1000, seed: 1, bot: 'auto' },
      autostart: true,
    });
    const result = await Promise.race([
      player.robot(init),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ROBOT_WALL_MS)),
    ]);
    if (!result) return null;
    const errors = result.raw.errors.length || (result.raw.state === 'crashed' ? 1 : 0);
    return { errors, seconds };
  } catch {
    return null;
  }
}

export interface HandinCheck {
  cast: CastInfo[];
  outcomes: CheckOutcome[];
}

/** Every goal checked, with evidence. `robot: false` skips the test (the result says "not tested"). */
export async function checkWorld(world: World, manifest: GameManifest | null, o: { robot: boolean }): Promise<HandinCheck> {
  const cast = castOf(world, manifest);
  const goals = goalsFor(world, cast);
  const [art, robot] = await Promise.all([
    artFactsOf(world),
    o.robot && goals.some((g) => g.kind === 'auto' && g.check.type === 'runs-clean') ? robotRun(world) : Promise.resolve(null),
  ]);
  const outcomes = runChecks(goals, { world, cast, art: (id) => art.get(id) ?? null, facts: codeFacts(world.code), robot });
  return { cast, outcomes };
}

/** The honesty line's numbers. */
export async function storyOf(world: World): Promise<Story> {
  const art = await artFactsOf(world);
  return buildStory(world, (id) => art.get(id)?.madeBy ?? null);
}

/** Initials: letters, digits, dots, spaces and dashes, at most 20 (never a real-name prompt). */
export function cleanInitials(text: string): string {
  return text.replace(/[^\p{L}\p{N}. -]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

/** "{title} - {initials}.amble" (without the initials when there are none). */
export function suggestedFileName(world: World, initials: string): string {
  const title = world.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'World';
  const who = cleanInitials(initials);
  return who ? `${title} - ${who}.amble` : `${title}.amble`;
}

export function withAmbleExtension(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return /\.amble$/i.test(clean) ? clean : `${clean || 'World'}.amble`;
}
