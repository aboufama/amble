/**
 * Forgiving names. Models (and students) reach for names the kit does not use: `fx.screenShake`,
 * `this.spawnPlayer`, `hero.play('victory')`, `sfx('explode')`. Known synonyms resolve (with a one-time
 * warning); unknown juice calls become warned no-ops instead of crashing a kid's game over a flourish.
 * The validator uses the same tables to auto-fix code before it runs. Pure.
 */

/** Synonyms inside the kit namespaces (fx, ui, pattern, controls, music, combo). */
export const NAMESPACE_SYNONYMS: Record<string, string> = {
  screenShake: 'shake', cameraShake: 'shake', shakeScreen: 'shake', shakeCamera: 'shake', quake: 'shake',
  explosion: 'explode', blowUp: 'explode', boom: 'explode',
  particles: 'burst', particleBurst: 'burst', emit: 'burst', sparkle: 'burst', sparks: 'burst',
  freeze: 'hitstop', hitStop: 'hitstop', hitPause: 'hitstop', freezeFrame: 'hitstop',
  slowMotion: 'slowmo', slowMo: 'slowmo', bulletTime: 'slowmo', slowTime: 'slowmo',
  zoomPunch: 'punch', zoomKick: 'punch', kick: 'punch',
  screenFlash: 'flash', flashScreen: 'flash', whiteFlash: 'flash',
  afterimage: 'ghost', afterImage: 'ghost', echo: 'ghost',
  chromatic: 'chroma', aberration: 'chroma', glitch: 'chroma',
  ring: 'shockwave', wave: 'shockwave', pulse: 'shockwave',
  floatingText: 'pop', popText: 'pop', damageNumber: 'pop', floatText: 'pop', scorePop: 'pop',
  title: 'big', bigText: 'big', showText: 'big', banner: 'big', announce: 'big', headline: 'big',
  message: 'hint', tip: 'hint', toast: 'hint',
  healthBar: 'bossBar', bossHealth: 'bossBar', bossHealthBar: 'bossBar',
  lives: 'hearts', hp: 'hearts', heartBar: 'hearts',
  speech: 'say', speak: 'say', bubble: 'say', talk: 'say',
  dialog: 'dialogue', conversation: 'dialogue', story: 'dialogue',
  countdown: 'timer',
  circle: 'ring', burstRing: 'ring', radial: 'ring', nova: 'ring',
  fan: 'spread', shotgun: 'spread', cone: 'spread',
  aim: 'aimed', target: 'aimed', snipe: 'aimed',
  swirl: 'spiral', vortex: 'spiral',
  beam: 'laser', ray: 'laser',
  isDown: 'held', down: 'held', pressedDown: 'held',
  justPressed: 'pressed', justDown: 'pressed', tapped: 'pressed',
  justReleased: 'released', up: 'released',
  start: 'play', begin: 'play', setIntensity: 'intensity', level: 'intensity', halt: 'stop', pause: 'stop',
  add: 'hit', increase: 'hit', clear: 'reset', stopCombo: 'reset',
};

/**
 * Synonyms for Scene methods: aliases on Amble.Scene that warn once and call the real method. Only names a
 * model invents (never Phaser's own Scene members such as `sound`, and no everyday words a game might use
 * for its own fields).
 */
export const SCENE_SYNONYMS: Record<string, string> = {
  spawnPlayer: 'spawnHero', createPlayer: 'spawnHero', addPlayer: 'spawnHero', makePlayer: 'spawnHero', createHero: 'spawnHero', addHero: 'spawnHero',
  createEnemy: 'spawnEnemy', addEnemy: 'spawnEnemy', makeEnemy: 'spawnEnemy',
  createBoss: 'spawnBoss', addBoss: 'spawnBoss',
  createItem: 'spawnItem', addItem: 'spawnItem', spawnPickup: 'spawnItem', addPickup: 'spawnItem', spawnCoin: 'spawnItem',
  shootBullet: 'shoot', spawnBullet: 'shoot', spawnShot: 'shoot', fireBullet: 'shoot',
  addPoints: 'addScore', scorePoints: 'addScore', increaseScore: 'addScore',
  playSound: 'sfx', playSfx: 'sfx', playEffect: 'sfx',
  gameOver: 'lose', loseGame: 'lose', winGame: 'win',
  setTimer: 'after', delayed: 'after', runLater: 'after', everyMs: 'every',
  camFollow: 'follow', followCamera: 'follow', cameraFollow: 'follow',
  makeLevel: 'level', buildLevel: 'level', loadLevel: 'level',
  addPlatform: 'platform', createPlatform: 'platform',
  addParallax: 'parallax',
  randomBetween: 'rand', randomRange: 'rand', randomPick: 'pick',
  distanceBetween: 'dist', angleBetween: 'angleTo',
};

/** Clip names a game might ask for, mapped to the kit's clips. */
export const CLIP_SYNONYMS: Record<string, string> = {
  stand: 'idle', rest: 'idle', breathe: 'idle',
  walking: 'walk', move: 'walk', running: 'run', sprint: 'run',
  hop: 'jump', leap: 'jump', jumping: 'jump', up: 'rise', falling: 'fall', drop: 'fall', landing: 'land',
  hit: 'hurt', ouch: 'hurt', damage: 'hurt', pain: 'hurt',
  punch: 'attack', swing: 'attack', slash: 'attack', strike: 'attack', stomp: 'attack',
  fire: 'shoot', cast: 'shoot', throw: 'shoot', shootUp: 'shoot',
  victory: 'cheer', win: 'cheer', celebrate: 'cheer', wave: 'cheer', happy: 'cheer', dance: 'cheer',
  ko: 'die', dead: 'die', death: 'die', faint: 'die', defeat: 'die', lose: 'die',
  angry: 'rage', mad: 'rage', furious: 'rage',
  flap: 'fly', flying: 'fly', hover: 'fly', soar: 'glide', swimming: 'swim', slither: 'swim',
  wobble: 'wiggle', jiggle: 'wiggle', shake: 'wiggle', rotate: 'spin', roll: 'spin',
};

export const CLIP_NAMES = [
  'idle', 'walk', 'run', 'jump', 'rise', 'fall', 'land', 'dash', 'attack', 'shoot', 'hurt', 'die', 'cheer', 'rage', 'fly', 'glide', 'swim', 'wiggle', 'spin',
] as const;
export type KitClip = (typeof CLIP_NAMES)[number];

/** Resolves a name against a table and the names that exist. */
export function resolveName(name: string, table: Record<string, string>, exists: (n: string) => boolean): string | null {
  if (exists(name)) return name;
  const direct = table[name];
  if (direct && exists(direct)) return direct;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(table)) if (k.toLowerCase() === lower && exists(v)) return v;
  return null;
}

/** The kit clip for a requested name ('victory' -> 'cheer'), or null for nonsense. */
export function resolveClip(name: string): KitClip | null {
  const n = String(name);
  const found = resolveName(n, CLIP_SYNONYMS, (c) => (CLIP_NAMES as readonly string[]).includes(c));
  return (found as KitClip | null) ?? null;
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** The closest known name within a small distance (case-insensitive), or null. */
export function suggest(name: string, known: readonly string[]): string | null {
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of known) {
    const kl = k.toLowerCase();
    if (kl === lower) return k;
    const d = kl.includes(lower) || lower.includes(kl) ? Math.abs(kl.length - lower.length) * 0.5 : editDistance(lower, kl);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

/**
 * Wraps a kit namespace (fx, ui, pattern...) so that synonyms resolve and unknown calls are warned no-ops.
 * `warn` is called once per distinct message.
 */
export function forgiving<T extends object>(target: T, ns: string, warn: (message: string) => void): T {
  const warned = new Set<string>();
  const once = (message: string): void => {
    if (warned.has(message)) return;
    warned.add(message);
    warn(message);
  };
  const members = (): string[] => {
    const names = new Set<string>(Object.keys(target));
    for (let p: object | null = Object.getPrototypeOf(target); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor' && !n.startsWith('_')) names.add(n);
    }
    return [...names];
  };
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop !== 'string' || prop in t || prop === 'then' || prop === 'toJSON') return Reflect.get(t, prop, receiver);
      const alias = resolveName(prop, NAMESPACE_SYNONYMS, (n) => n in t);
      if (alias) {
        once(`this.${ns}.${prop} is called this.${ns}.${alias}`);
        const v: unknown = Reflect.get(t, alias, receiver);
        return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(t) : v;
      }
      const near = suggest(prop, members());
      once(`this.${ns}.${prop}() does not exist${near ? `; did you mean this.${ns}.${near}()?` : ''} (ignored)`);
      return () => undefined;
    },
  });
}

/** Sound names a game might use, mapped to the kit's synth sounds ('explode' -> 'explosion'). */
export function guessSound(name: string, known: readonly string[]): string {
  const n = String(name).toLowerCase().replace(/\.(wav|mp3|ogg|m4a)$/, '');
  if (known.includes(n)) return n;
  for (const k of known) if (n.includes(k) || (k.length > 3 && k.includes(n))) return k;
  if (/shoot|fire|pew|gun|blast/.test(n)) return 'shoot';
  if (/explo|bomb|kaboom/.test(n)) return 'explosion';
  if (/die|dead|death|over|fail/.test(n)) return 'lose';
  if (/collect|pick|gem|star|ding|cash/.test(n)) return 'coin';
  if (/click|select|menu|ui|beep/.test(n)) return 'blip';
  if (/ouch|damage|pain/.test(n)) return 'hurt';
  if (/music|song|theme|bgm/.test(n)) return 'blip';
  return 'pop';
}
