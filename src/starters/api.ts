/**
 * The starter worlds and seeds (§9, §8.4; M8 owns). FOUNDATION-STUB: every starter opens the same fixture
 * game (as a new world, with no drawings except the given hero); `matchIdea` scores the §9 tags.
 */
import { t, type MessageKey } from '../i18n';
import type { ArtScript } from '../cores/art';
import { uid } from '../model/ids';
import type { ArtId, ArtRecord, CastKey, CastSlot, CodeFile, SeedId, StarterId, StarterInfo, World } from '../model/types';
import { getState } from '../state/store';
import { FIXTURE_GAME } from './fixtureGame';

export interface StarterCatalog {
  /** The five starters, in Trail order. */
  list(): StarterInfo[];
  info(id: SeedId): StarterInfo;
  /** A new world copy. withArt: the starter's own drawings; otherwise a seed (only `hero`, if given, is drawn). */
  open(id: SeedId, o: { withArt: boolean; hero?: ArtId }): Promise<{ world: World; art: ArtRecord[]; blobs: Blob[] }>;
  /** For "Watch it drawn". */
  script(id: StarterId, key: CastKey): Promise<ArtScript | null>;
  /** The ladder's local keyword match (§5.9). */
  matchIdea(idea: string): StarterId;
}

interface StarterDef {
  id: SeedId;
  ns: 'moonKing' | 'skyRun' | 'wobbleTower' | 'lanternMaze' | 'clanksClimb' | 'parade';
  heroKey: CastKey;
  yourTurn: CastKey | null;
  spare: CastKey[];
  tags: string[];
}

const DEFS: StarterDef[] = [
  {
    id: 'moon-king',
    ns: 'moonKing',
    heroKey: 'hero',
    yourTurn: 'grumble',
    spare: ['bubbles'],
    tags: ['boss', 'fight', 'giant', 'king', 'queen', 'monster', 'dragon', 'shoot', 'space', 'moon', 'alien', 'robot army'],
  },
  { id: 'sky-run', ns: 'skyRun', heroKey: 'hero', yourTurn: 'bloop', spare: ['kite'], tags: ['run', 'runner', 'race', 'fast', 'endless', 'dash', 'sky', 'fly', 'jump over', 'chase'] },
  {
    id: 'wobble-tower',
    ns: 'wobbleTower',
    heroKey: 'wobbles',
    yourTurn: 'crate',
    spare: ['boulder'],
    tags: ['tower', 'stack', 'blocks', 'crash', 'smash', 'physics', 'topple', 'build', 'explode', 'wobble'],
  },
  { id: 'lantern-maze', ns: 'lanternMaze', heroKey: 'hero', yourTurn: 'boo', spare: ['pal'], tags: ['maze', 'ghost', 'dungeon', 'sneak', 'collect', 'find', 'escape', 'hide', 'dark', 'keys'] },
  { id: 'clanks-climb', ns: 'clanksClimb', heroKey: 'hero', yourTurn: 'spiky', spare: ['buddy'], tags: ['climb', 'jump', 'platform', 'lava', 'rise', 'goo', 'robot', 'reach', 'top', 'rocket'] },
  { id: 'parade', ns: 'parade', heroKey: 'hero', yourTurn: null, spare: [], tags: [] },
];

/** The fixture game's art keys (the stub opens it for every starter). */
const FIXTURE_KEYS: CastKey[] = ['hero', 'moonKing', 'grumble', 'star', 'ground', 'ledge', 'shot', 'orb'];

function infoOf(d: StarterDef): StarterInfo {
  return {
    id: d.id,
    title: t(`starters.${d.ns}Title` as MessageKey),
    genre: t(`starters.${d.ns}Genre` as MessageKey),
    blurb: t(`starters.${d.ns}Blurb` as MessageKey),
    teaches: t(`starters.staff_${d.ns}Teaches` as MessageKey),
    sign: '',
    heroKey: d.heroKey,
    yourTurn: d.yourTurn,
    spare: d.spare,
    tags: d.tags,
    hidden: d.id === 'parade',
  };
}

/** How many of a starter's tags appear in the idea (whole words or phrases). */
export function tagScore(idea: string, tags: string[]): number {
  const text = ` ${idea.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return tags.reduce((n, tag) => n + (text.includes(` ${tag} `) || text.includes(` ${tag}s `) ? 1 : 0), 0);
}

function slot(key: CastKey): CastSlot {
  return { key, art: null, madeBy: null, extra: null, laterUntil: 0 };
}

export function createStarterStub(): StarterCatalog {
  const byId = new Map(DEFS.map((d) => [d.id, d]));
  const info = (id: SeedId): StarterInfo => infoOf(byId.get(id) ?? DEFS[0]);
  return {
    list: () => DEFS.filter((d) => d.id !== 'parade').map(infoOf),
    info,
    async open(id, o) {
      const i = info(id);
      const now = Date.now();
      const code: CodeFile[] = [{ path: 'game.js', source: FIXTURE_GAME, authors: [['starter', FIXTURE_GAME.split('\n').length]], locked: [] }];
      const cast: Record<CastKey, CastSlot> = {};
      for (const key of FIXTURE_KEYS) cast[key] = slot(key);
      const heroKey = cast[i.heroKey] ? i.heroKey : 'hero';
      if (o.hero) cast[heroKey] = { ...cast[heroKey], art: o.hero, madeBy: 'student' };
      const step = { id: uid('s_'), at: now, by: 'student' as const, kind: 'start' as const, text: t('starters.stepStarted', { title: i.title }) };
      const world: World = {
        format: 'amble-world',
        version: 1,
        id: uid('w_'),
        title: i.title,
        pitch: '',
        level: getState().config.level,
        createdAt: now,
        updatedAt: now,
        openedAt: now,
        origin: id === 'parade' ? { kind: 'parade' } : { kind: 'starter', starter: id, withArt: o.withArt },
        code,
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
      return { world, art: [], blobs: [] };
    },
    script: async () => null,
    matchIdea(idea) {
      let best: StarterId = 'moon-king';
      let bestScore = 0;
      for (const d of DEFS) {
        if (d.id === 'parade') continue;
        const score = tagScore(idea, d.tags);
        if (score > bestScore) {
          best = d.id as StarterId;
          bestScore = score;
        }
      }
      return best;
    },
  };
}
