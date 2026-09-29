/** The kit manifest, normalized for fast lookups, plus the name matching behind "did you mean". */
import type { KitManifest } from './types';

/** Members every Phaser 3.90 scene has, whatever the kit adds. */
export const PHASER_SCENE_MEMBERS: readonly string[] = [
  'sys', 'game', 'anims', 'cache', 'registry', 'sound', 'textures', 'events', 'cameras', 'add', 'make', 'scene', 'children',
  'lights', 'data', 'input', 'load', 'time', 'tweens', 'physics', 'matter', 'scale', 'plugins', 'renderer',
  'init', 'preload', 'create', 'update', 'constructor',
];

/** Kit objects' methods that take option objects, when the manifest doesn't list its own. */
export const DEFAULT_ACTOR_METHODS: readonly string[] = ['platformer', 'runner', 'topdown', 'shooter', 'patrol', 'chase', 'flyer', 'orbit', 'wander', 'follow'];

/** Scene names the kit owns (from the probe kit); assigning them breaks the kit. */
export const DEFAULT_RESERVED: readonly string[] = ['fx', 'ui', 'controls', 'music', 'combo', 'pattern'];

/** What models reach for, and what the kit calls it. Shared with the runtime's forgiving namespaces. */
export const DEFAULT_SYNONYMS: Readonly<Record<string, string>> = {
  spawnPlayer: 'spawnHero', createPlayer: 'spawnHero', addPlayer: 'spawnHero', makePlayer: 'spawnHero', spawnBoss: 'spawnEnemy', createEnemy: 'spawnEnemy',
  addEnemy: 'spawnEnemy', createBullet: 'shoot', fireBullet: 'shoot', fire: 'shoot', playSound: 'sfx', sound: 'sfx', playSfx: 'sfx', delay: 'after',
  setTimeout: 'after', repeat: 'every', loop: 'every', gameOver: 'lose', victory: 'win', youWin: 'win', explode: 'blast',
  screenShake: 'shake', cameraShake: 'shake', shakeScreen: 'shake', explosion: 'explode', particles: 'burst', particleBurst: 'burst', emit: 'burst',
  freeze: 'hitstop', hitStop: 'hitstop', slowMotion: 'slowmo', slowMo: 'slowmo', zoomPunch: 'punch', screenFlash: 'flash', flashScreen: 'flash',
  afterimage: 'ghost', chromatic: 'chroma', floatingText: 'pop', popText: 'pop', damageNumber: 'pop', title: 'big', bigText: 'big', showText: 'big',
  banner: 'big', message: 'hint', healthBar: 'bossBar', bossHealth: 'bossBar', lives: 'hearts', circle: 'ring', burstRing: 'ring', fan: 'spread', aim: 'aimed',
};

export interface Api {
  globals: ReadonlySet<string>;
  sceneMethods: ReadonlySet<string>;
  namespaces: ReadonlyMap<string, ReadonlySet<string>>;
  actorMethods: ReadonlySet<string>;
  synonyms: Readonly<Record<string, string>>;
  reserved: ReadonlySet<string>;
}

export function normalizeManifest(m: KitManifest): Api {
  const scene = new Set<string>();
  const namespaces = new Map<string, Set<string>>();
  const addNs = (ns: string, member: string) => {
    if (!namespaces.has(ns)) namespaces.set(ns, new Set());
    namespaces.get(ns)?.add(member);
  };
  for (const entry of m.sceneMethods) {
    const dot = entry.indexOf('.');
    if (dot > 0) {
      scene.add(entry.slice(0, dot));
      addNs(entry.slice(0, dot), entry.slice(dot + 1));
    } else scene.add(entry);
  }
  for (const [ns, members] of Object.entries(m.namespaces ?? {})) {
    scene.add(ns);
    for (const member of members) addNs(ns, member);
  }
  return {
    globals: new Set(m.globals),
    sceneMethods: scene,
    namespaces,
    actorMethods: new Set(m.actorMethods ?? DEFAULT_ACTOR_METHODS),
    synonyms: { ...DEFAULT_SYNONYMS, ...(m.synonyms ?? {}) },
    reserved: new Set(m.reserved ?? DEFAULT_RESERVED),
  };
}

function lev(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** The closest real name: a known synonym, then a containing name, then a shared prefix, then edit distance. */
export function closest(name: string, candidates: Iterable<string>, synonyms: Readonly<Record<string, string>>): string | null {
  const names = [...candidates];
  const syn = synonyms[name];
  if (syn && names.includes(syn)) return syn;
  const low = name.toLowerCase();
  const sub = names.filter((n) => n.length >= 4 && (low.includes(n.toLowerCase()) || n.toLowerCase().includes(low)));
  if (sub.length) return sub.sort((a, b) => b.length - a.length)[0];
  const pre = names.filter((n) => low.length >= 5 && n.slice(0, 5).toLowerCase() === low.slice(0, 5));
  if (pre.length === 1) return pre[0];
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const n of names) {
    const dist = lev(name, n);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = n;
    }
  }
  return bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}
