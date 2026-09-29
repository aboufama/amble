/**
 * The kit as the pipeline sees it: the member docs behind the prompt's cheat sheet, and the name lists
 * behind validation. It prefers the player core's `KIT_API` (through the barrel); until that core has
 * merged, it uses a copy of the kit's own manifest (src/runtime/kit/manifest.ts in the player core), so
 * the prompt and the validator describe the kit that really runs.
 */
import { KIT_API, type KitApi } from '../cores/play';
import type { KitManifest } from '../cores/ai';

/** One member: its name, a short signature and one line of docs. */
export interface KitDoc {
  name: string;
  sig: string;
  doc: string;
}

/** The kit's docs by where they live: `this.*`, what spawn helpers return, and the `this.<ns>` namespaces. */
export interface KitDocs {
  scene: KitDoc[];
  actor: KitDoc[];
  namespaces: Record<string, KitDoc[]>;
}

type Table = ReadonlyArray<readonly [name: string, sig: string, doc: string]>;

const docs = (t: Table): KitDoc[] => t.map(([name, sig, doc]) => ({ name, sig, doc }));

const SCENE: Table = [
  ['dials', 'dials: Record<string, number>', 'Live dial values: this.dials.jump is always the current value.'],
  ['dial', 'dial: Record<string, number>', 'Same as this.dials.'],
  ['hero', 'hero: Actor | null', 'The hero (set by spawnHero).'],
  ['score', 'score: number', 'The score (setting it updates the HUD).'],
  ['clock', 'clock: number', 'Game time in ms: slows in slow motion, stops in hit-stop and pause.'],
  ['timeScale', 'timeScale: number', 'Game speed (0.25 = slow motion).'],
  ['gravityFlipped', 'gravityFlipped: boolean', 'True while gravity is flipped.'],
  ['levelNumber', 'levelNumber: number', 'The level set by setLevel().'],
  ['tune', 'tune(name, value, { min, max, step, label, live, for })', 'Declares a dial (if new) and returns its current value.'],
  ['art', 'art(key): string', 'Texture key for a piece of art: the drawing or its stand-in.'],
  ['hasArt', 'hasArt(key): boolean', 'Has the student drawn it yet? (spare art)'],
  ['spawn', 'spawn(x, y, key, o?): Actor', 'Spawns anything from an art key: characters get bones, everything gets health and behaviours.'],
  ['spawnHero', "spawnHero(x, y, key = 'hero', o?): Actor", 'The player: health, lands on platforms, takes hits.'],
  ['spawnEnemy', "spawnEnemy(x, y, key = 'enemy', o?): Actor", 'An enemy in the enemies group.'],
  ['spawnBoss', "spawnBoss(x, y, key = 'boss', o?): Actor", 'A boss: lots of health, no gravity, no knockback.'],
  ['spawnItem', "spawnItem(x, y, key = 'coin', o?): Actor", 'A pickup: sparkles and scores when the hero touches it.'],
  ['spawnProjectile', 'spawnProjectile(x, y, key, { angle, speed }): Sprite', 'A shot that nobody fired.'],
  ['all', 'all(group): Actor[]', "Active members of a group ('enemies', 'items', 'hazards' or your own)."],
  ['group', 'group(name, o?): Arcade.Group', 'A named group (made on first use).'],
  ['shoot', 'shoot(from, angleOrTarget?, o?): Sprite | null', 'Fires a pooled shot (degrees: 0 right, 90 down) or at a target.'],
  ['collide', 'collide(a, b, (a, b) => {})', 'Solid collisions between objects, groups or group names.'],
  ['overlap', 'overlap(a, b, (a, b) => {})', 'Pass-through touching between objects, groups or group names.'],
  ['every', 'every(ms, fn): TimerEvent', 'Runs fn every ms of game time (ms may be live).'],
  ['after', 'after(ms, fn): TimerEvent', 'Runs fn once after ms of game time.'],
  ['wait', 'wait(ms): Promise', 'await this.wait(500) inside async code.'],
  ['cooldown', 'cooldown(name, ms): boolean', 'True at most once every ms for a name.'],
  ['brain', 'brain(obj, { state: { time, next, enter, update, exit } }, start?)', 'A state machine for enemies and bosses.'],
  ['phases', 'phases(obj, [{ at, name, sub, enter }])', 'Boss phases by health fraction, with a big transition.'],
  ['waves', 'waves([{ count, every, title, spawn }], { between, onWave, onClear })', 'Waves of enemies.'],
  ['follow', 'follow(obj, { lerp, lockY, offsetX, deadzone, lookahead })', 'The camera follows something.'],
  ['worldSize', 'worldSize(w, h)', 'The size of the world (camera and physics bounds).'],
  ['parallax', "parallax([{ draw: 'stars' | 'mountains' | 'hills' | 'clouds' | 'city', key, color, factor, y, height }])", 'Scrolling scenery layers.'],
  ['weather', "weather('rain' | 'snow' | 'embers' | 'bubbles', { amount })", 'Screen-wide weather particles.'],
  ['level', 'level(rows, { tile, legend })', "A level from text rows ('#' is ground)."],
  ['platform', "platform(x, y, w, h?, key = 'ground', { oneWay })", 'A solid platform tiled with a terrain drawing.'],
  ['chunks', 'chunks({ size, start, make(x0, index) })', 'An endless world built just ahead of the camera.'],
  ['flipGravity', 'flipGravity(): 1 | -1', 'Flips gravity for everything.'],
  ['portal', 'portal(a, b, { color, key })', 'Two portals that swap whatever touches them.'],
  ['win', "win(text = 'YOU WIN!')", 'Ends the level as a win (confetti, score, play again).'],
  ['lose', "lose(text = 'OH NO!')", 'Ends the level as a loss.'],
  ['restart', 'restart()', 'Starts the level again.'],
  ['setLevel', 'setLevel(n, title?)', 'Announces a new level.'],
  ['addScore', 'addScore(n, x?, y?): number', 'Adds combo-multiplied points and pops "+n".'],
  ['highScore', 'highScore(): number', 'The best score saved with the game.'],
  ['setHighScore', 'setHighScore(n)', 'Saves a best score.'],
  ['sfx', 'sfx(name | segments, { volume, pitch })', 'Plays a synth sound (coin, jump, laser, explosion...) or a recorded one.'],
  ['rand', 'rand(a?, b?): number', 'A random number between a and b.'],
  ['pick', 'pick(list)', 'A random item of a list.'],
  ['chance', 'chance(p): boolean', 'True with probability p (0..1).'],
  ['dist', 'dist(a, b): number', 'Distance between two points.'],
  ['angleTo', 'angleTo(a, b): number', 'Degrees from a to b (0 right, 90 down).'],
  ['blast', 'blast(x, y, { radius, power })', 'Pushes every body near (x, y) away.'],
  ['box', 'box(x, y, w, h, { key, bounce, static })', 'A Matter box.'],
  ['ball', 'ball(x, y, r, { key, bounce })', 'A Matter ball.'],
  ['stack', 'stack(x, y, cols, rows, { w, h, key })', 'A stack of Matter boxes.'],
  ['pyramid', 'pyramid(x, y, rows, { w, h, key })', 'A pyramid of Matter boxes.'],
  ['wreckingBall', 'wreckingBall(ax, ay, { length, radius, angle, key })', 'A heavy ball on a chain.'],
  ['ragdoll', "ragdoll(x, y, key = 'dummy', { scale })", "A floppy ragdoll cut from a character's own picture."],
  ['grab', 'grab({ stiffness })', 'Drag Matter bodies with the mouse or a finger.'],
  ['impacts', 'impacts({ speed })', 'Sparks and thuds when Matter bodies hit hard.'],
  ['stats', 'stats(): Stats', 'Numbers about the running game.'],
  ['usedActions', 'usedActions(): Action[]', 'The actions the game reads (for touch buttons).'],
];

const ACTOR: Table = [
  ['platformer', 'platformer({ speed, jump, jumps, dash, stomp })', 'Run and jump (coyote time, jump buffer, double jump, dash).'],
  ['runner', 'runner({ speed, maxSpeed, speedUp, jump, jumps })', 'Runs right by itself and speeds up.'],
  ['topdown', 'topdown({ speed })', 'Moves in 8 directions (no gravity).'],
  ['flyer', 'flyer({ speed, lift, glide })', 'Flaps up with jump, glides down.'],
  ['shooter', "shooter({ key, every, speed, aim: 'facing' | '8way' | 'pointer' | 'up', auto })", 'Fires shots while fire is held.'],
  ['patrol', 'patrol(speed?, { min, max })', 'Walks back and forth.'],
  ['chase', 'chase(target, speed?)', 'Moves toward a target.'],
  ['wander', 'wander({ speed, radius })', 'Wanders around its home.'],
  ['orbit', 'orbit(center, radius, speed?)', 'Circles a point.'],
  ['jump', 'jump(velocity?)', 'Jumps once.'],
  ['damage', 'damage(n?, { from, knockback }): boolean', 'Hurts it (with a flash, particles and knockback).'],
  ['heal', 'heal(n?)', 'Gives back health.'],
  ['kill', 'kill()', 'Defeats it at once.'],
  ['play', 'play(move, { once, lock })', 'Plays a move: idle walk run jump attack shoot hurt die cheer rage fly swim wiggle spin...'],
  ['face', 'face(dir)', 'Turns left (-1) or right (1).'],
  ['lookAt', 'lookAt(target | null)', 'Keeps turning toward a target.'],
  ['attach', "attach(obj, 'head' | 'hat' | 'hand' | 'back' | 'feet')", 'Characters carry something (a hat, a wand).'],
  ['setArt', 'setArt(key)', 'Characters turn into another drawing.'],
  ['ghost', 'ghost(color?)', 'Characters leave an afterimage.'],
  ['hp', 'hp: number', 'Health.'],
  ['maxHp', 'maxHp: number', 'Full health.'],
  ['alive', 'alive: boolean', 'False once defeated.'],
  ['invincible', 'invincible: boolean', 'Cannot be hurt.'],
  ['points', 'points: number', 'Score when defeated.'],
  ['contactDamage', 'contactDamage: number', 'Damage it does by touching the hero (0: harmless).'],
  ['smash', 'smash: boolean', 'Defeats enemies it touches.'],
  ['onGround', 'onGround: boolean', 'Characters: standing on something.'],
  ['drawn', 'drawn: boolean', 'Characters: false while it is a stand-in.'],
];

const FX: Table = [
  ['shake', 'shake(intensity = 0.01, ms = 180)', 'Camera shake (0.005 small ... 0.03 huge).'],
  ['hitstop', 'hitstop(ms = 60)', 'Freezes the world for a moment.'],
  ['slowmo', 'slowmo(scale = 0.3, ms = 900)', 'Slow motion that eases back.'],
  ['flash', 'flash(color, ms, alpha)', 'A soft full-screen flash (at most 3 a second).'],
  ['punch', 'punch(amount = 0.05, ms)', 'A camera zoom kick.'],
  ['chroma', 'chroma(amount, ms)', 'Colour fringing.'],
  ['desaturate', 'desaturate(amount, ms)', 'Drains the colour for a moment.'],
  ['vignette', 'vignette(strength)', 'Darkens the edges.'],
  ['bloom', 'bloom(on = true)', 'A glow over bright things.'],
  ['burst', 'burst(x, y, { colors, count, speed, life, size, frames })', 'A burst of particles.'],
  ['explode', 'explode(x, y, { size, color, power })', 'A big explosion in one call.'],
  ['shockwave', 'shockwave(x, y, { radius, color })', 'An expanding ring.'],
  ['dust', 'dust(obj)', 'A puff of dust at its feet.'],
  ['squash', 'squash(obj, sx, sy, ms)', 'Squash and stretch (pictures only, never hitboxes).'],
  ['trail', 'trail(obj, { color, life })', 'A particle trail behind it.'],
  ['ghost', 'ghost(obj, color)', 'An afterimage.'],
  ['hurtFlash', 'hurtFlash(obj, ms)', 'The white hurt flash.'],
  ['halo', 'halo(obj, color, size)', 'A glow that follows it.'],
  ['lightning', 'lightning(x1, y1, x2, y2, { color })', 'A lightning bolt.'],
  ['confetti', 'confetti(count = 80)', 'Confetti everywhere.'],
  ['motion', 'motion: number', '1, or 0.25 with reduced motion.'],
];

const UI: Table = [
  ['text', 'text(x, y, str, { size, color })', 'Text on the HUD.'],
  ['big', 'big(str, { sub, color, size, ms })', 'A big centre title: "PHASE 2!".'],
  ['pop', 'pop(x, y, str, { color, size })', 'Floating world text: "+100".'],
  ['hint', 'hint(str, ms = 5000)', 'A hint line at the bottom.'],
  ['score', 'score(): Text', 'Shows the score (top right).'],
  ['setScore', 'setScore(v)', 'Updates the score shown.'],
  ['hearts', 'hearts(obj)', 'Hearts for hit points (top left).'],
  ['bossBar', "bossBar(obj, name = 'BOSS', { color })", 'A wide boss health bar.'],
  ['bar', 'bar(obj, { width, color })', 'A small health bar over something.'],
  ['say', 'say(obj, str, ms)', 'A speech bubble.'],
  ['dialogue', 'dialogue([{ who, text }]): Promise', 'A conversation (Space or tap moves on).'],
  ['button', 'button(x, y, label, onClick)', 'A clickable button.'],
  ['timer', 'timer(seconds, onDone?)', 'A countdown.'],
  ['panel', 'panel([[text, size, color]], { top, alpha, name })', 'A full-screen panel of lines.'],
  ['clearPanel', 'clearPanel(name)', 'Removes a named panel.'],
];

const CONTROLS: Table = [
  ['x', 'x: number', '-1..1 (keys, stick or pad).'],
  ['y', 'y: number', '-1..1.'],
  ['left', 'left: boolean', 'Held.'],
  ['right', 'right: boolean', 'Held.'],
  ['up', 'up: boolean', 'Held.'],
  ['down', 'down: boolean', 'Held.'],
  ['jump', 'jump: boolean', 'Held.'],
  ['fire', 'fire: boolean', 'Held.'],
  ['dash', 'dash: boolean', 'Held.'],
  ['action', 'action: boolean', 'Held.'],
  ['held', 'held(action): boolean', 'The action is held down.'],
  ['pressed', 'pressed(action): boolean', 'The action started this frame.'],
  ['released', 'released(action): boolean', 'The action ended this frame.'],
  ['pointer', 'pointer: { x, y, down, justDown }', 'The mouse or finger, in world coordinates.'],
  ['bind', 'bind: Record<Action, string[]>', 'Keys per action.'],
  ['virtual', 'virtual: Record<Action, boolean>', 'What the touch buttons press.'],
];

const MUSIC: Table = [
  ['play', "play('boss' | 'adventure' | 'chase' | 'chill' | 'spooky' | 'chaos', { bpm })", 'Starts music.'],
  ['intensity', 'intensity(0 | 1 | 2)', 'Calmer or wilder music.'],
  ['stop', 'stop()', 'Stops the music.'],
];

const COMBO: Table = [
  ['count', 'count: number', 'Hits in the current combo.'],
  ['best', 'best: number', 'The best combo.'],
  ['window', 'window: number', 'ms without a hit before it ends.'],
  ['mult', 'mult: number', 'The score multiplier.'],
  ['hit', 'hit(x?, y?): number', 'Counts a hit.'],
  ['reset', 'reset()', 'Ends the combo.'],
];

const PATTERN: Table = [
  ['ring', 'ring(from, { key, count, speed, petals })', 'Shots in every direction.'],
  ['spread', 'spread(from, angle, { count, arc, speed })', 'A fan of shots.'],
  ['aimed', 'aimed(from, target, { count, arc })', 'Shots at a target.'],
  ['spiral', 'spiral(from, { arms, turn, every, duration })', 'A spinning spiral of shots.'],
  ['rain', 'rain({ count, speed })', 'Shots falling from the top.'],
  ['wall', 'wall(from, angle, { count, gap, hole })', 'A wall of shots with a hole.'],
  ['laser', 'laser(from, angle, { warn, duration, sweep })', 'A laser (always warned first).'],
];

const TWISTS: Table = [
  ['isOn', 'isOn(id): boolean', 'Is this twist switched on?'],
  ['list', 'list: string[]', 'The twists switched on.'],
];

/** A copy of the kit's own manifest, used until the player core's `KIT_API` reaches the barrel. */
export const FALLBACK_KIT_DOCS: KitDocs = {
  scene: docs(SCENE),
  actor: docs(ACTOR),
  namespaces: { fx: docs(FX), ui: docs(UI), controls: docs(CONTROLS), music: docs(MUSIC), combo: docs(COMBO), pattern: docs(PATTERN), twists: docs(TWISTS) },
};

/** Phaser's own scene members that game code uses on `this`. */
const PHASER_SCENE = [
  'sys', 'game', 'anims', 'cache', 'registry', 'sound', 'textures', 'events', 'cameras', 'add', 'make', 'scene', 'children', 'lights',
  'data', 'input', 'load', 'time', 'tweens', 'physics', 'matter', 'scale', 'plugins', 'renderer', 'init', 'preload', 'create', 'update',
];

/** Scene properties the kit owns: game code must not assign them. */
const RESERVED = ['fx', 'ui', 'controls', 'music', 'combo', 'pattern', 'twists', 'dials', 'dial', 'clock', 'gravityFlipped', 'levelNumber'];

/** Names models invent, mapped to the kit's (a subset of the kit's own table; the core adds its defaults). */
const SYNONYMS: Record<string, string> = {
  spawnPlayer: 'spawnHero', createPlayer: 'spawnHero', addPlayer: 'spawnHero', makePlayer: 'spawnHero',
  createEnemy: 'spawnEnemy', addEnemy: 'spawnEnemy', createBoss: 'spawnBoss', addBoss: 'spawnBoss',
  createItem: 'spawnItem', addItem: 'spawnItem', spawnCoin: 'spawnItem', spawnPickup: 'spawnItem',
  fireBullet: 'shoot', createBullet: 'shoot', playSound: 'sfx', delay: 'after', repeat: 'every',
  gameOver: 'lose', victory: 'win', youWin: 'win',
};

// ------------------------------------------------------------------ reading KIT_API in either shape

type Loose = Record<string, unknown>;

function isDocList(v: unknown): v is KitDoc[] {
  return Array.isArray(v) && v.every((m) => typeof m === 'object' && m !== null && typeof (m as Loose).name === 'string');
}

function asDoc(m: Loose): KitDoc {
  const sig = typeof m.sig === 'string' ? m.sig : typeof m.signature === 'string' ? m.signature : String(m.name);
  return { name: String(m.name), sig, doc: typeof m.doc === 'string' ? m.doc : '' };
}

/** The docs from a `KIT_API`: the core's shape (`docs.scene`, `docs.actor`, `docs.fx`...) or the barrel's (`namespaces[]`). */
export function docsOf(api: KitApi | Loose): KitDocs | null {
  const a = api as Loose;
  const d = a.docs as Loose | undefined;
  if (d && isDocList(d.scene)) {
    const namespaces: Record<string, KitDoc[]> = {};
    for (const [ns, list] of Object.entries(d)) if (ns !== 'scene' && ns !== 'actor' && isDocList(list)) namespaces[ns] = list.map((m) => asDoc(m as unknown as Loose));
    return { scene: d.scene.map((m) => asDoc(m as unknown as Loose)), actor: isDocList(d.actor) ? d.actor.map((m) => asDoc(m as unknown as Loose)) : [], namespaces };
  }
  const list = a.namespaces;
  if (Array.isArray(list) && list.length) {
    const out: KitDocs = { scene: [], actor: [], namespaces: {} };
    for (const ns of list as Loose[]) {
      const members = Array.isArray(ns.members) ? (ns.members as Loose[]).map(asDoc) : [];
      const name = typeof ns.name === 'string' ? ns.name : '';
      if (name === '') out.scene.push(...members);
      else if (name === 'actor') out.actor.push(...members);
      else out.namespaces[name] = members;
    }
    return out.scene.length ? out : null;
  }
  return null;
}

/** The kit's docs: from the merged player core when it has them, else the copy above. */
export function kitDocs(api: KitApi | Loose = KIT_API): KitDocs {
  const from = docsOf(api);
  if (!from) return FALLBACK_KIT_DOCS;
  // A core that ships no actor docs still has the behaviours: keep ours so the cheat sheet lists them.
  return from.actor.length ? from : { ...from, actor: FALLBACK_KIT_DOCS.actor };
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
}

/** The validator's view of the kit (§5.7): names on `this`, the namespaces, behaviours, synonyms, reserved names. */
export function kitManifestFor(api: KitApi | Loose = KIT_API): KitManifest {
  const a = api as Loose;
  const globals = strings(a.globals);
  const sceneMethods = strings(a.sceneMethods);
  if (globals && sceneMethods) {
    const namespaces: Record<string, string[]> = {};
    for (const [ns, list] of Object.entries((a.namespaces as Loose | undefined) ?? {})) {
      const names = strings(list);
      if (names) namespaces[ns] = names;
    }
    return {
      globals,
      sceneMethods,
      namespaces,
      actorMethods: strings(a.actorMethods) ?? FALLBACK_KIT_DOCS.actor.map((m) => m.name),
      synonyms: { ...SYNONYMS, ...((a.synonyms as Record<string, string> | undefined) ?? {}) },
      reserved: strings(a.reserved) ?? RESERVED,
    };
  }
  const d = kitDocs(api);
  const namespaces: Record<string, string[]> = {};
  for (const [ns, list] of Object.entries(d.namespaces)) namespaces[ns] = list.map((m) => m.name);
  return {
    globals: ['Amble', 'Phaser', 'localStorage', 'sessionStorage'],
    sceneMethods: [...new Set([...PHASER_SCENE, ...d.scene.map((m) => m.name), ...Object.keys(namespaces)])],
    namespaces,
    actorMethods: d.actor.map((m) => m.name),
    synonyms: SYNONYMS,
    reserved: RESERVED,
  };
}

/** The signature line for `this.<name>`, `this.<ns>.<name>` or an actor's `<name>`, for repair requests. */
export function signatureOf(path: string, d: KitDocs = kitDocs()): string | null {
  const m = /^(?:this\.)?(?:(\w+)\.)?(\w+)$/.exec(path);
  if (!m) return null;
  const [, ns, name] = m;
  if (ns && d.namespaces[ns]) {
    const doc = d.namespaces[ns].find((x) => x.name === name);
    return doc ? `this.${ns}.${doc.sig}  // ${doc.doc}` : null;
  }
  const scene = d.scene.find((x) => x.name === name);
  if (scene) return `this.${scene.sig}  // ${scene.doc}`;
  const actor = d.actor.find((x) => x.name === name);
  return actor ? `actor.${actor.sig}  // ${actor.doc}` : null;
}
