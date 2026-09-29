/**
 * KIT_API: the kit's API as data, for the AI prompt's cheat sheet, the validator's name lists and the code
 * view's autocomplete and hover docs. It matches amble-kit.d.ts (a test checks both ways, and the player's
 * e2e test checks every name exists in a running game). Pure: no Phaser, safe in workers and tests.
 */
import { NAMESPACE_SYNONYMS, SCENE_SYNONYMS, CLIP_NAMES } from './synonyms';
import { SOUND_NAMES, MUSIC_STYLES } from './names';
import { TWISTS } from './twistCatalog';
import { ACTIONS, ART_KINDS, ART_SHAPES, RIG_KINDS, ROLES } from '../protocol';

/** One member: its name, a short signature and one line of docs. */
export interface KitMember {
  name: string;
  sig: string;
  doc: string;
}

type Table = ReadonlyArray<readonly [name: string, sig: string, doc: string]>;

const members = (t: Table): KitMember[] => t.map(([name, sig, doc]) => ({ name, sig, doc }));

const SCENE: Table = [
  ['fx', 'fx: Fx', 'Juice: shake, hitstop, slowmo, flash, burst, explode, squash, trail...'],
  ['ui', 'ui: Ui', 'The HUD: big titles, hints, score, hearts, boss bars, speech bubbles, dialogue.'],
  ['controls', 'controls: Controls', 'Keyboard, touch buttons and gamepad as actions: controls.x, held(), pressed().'],
  ['music', 'music: Music', 'Synthesized music: music.play(style).'],
  ['combo', 'combo: Combo', 'Combo counter that multiplies the score.'],
  ['pattern', 'pattern: Pattern', 'Bullet patterns: ring, spread, aimed, spiral, rain, wall, laser.'],
  ['twists', 'twists: Twists', 'The twists the student switched on (read-only): twists.isOn(id).'],
  ['dials', 'dials: Record<string, number>', 'Live dial values: this.dials.jump is always the current value.'],
  ['dial', 'dial: Record<string, number>', 'Same as this.dials.'],
  ['hero', 'hero: Actor | null', 'The hero (set by spawnHero).'],
  ['score', 'score: number', 'The score (setting it updates the HUD).'],
  ['clock', 'clock: number', 'Game time in ms: slows in slow motion, stops in hit-stop and pause.'],
  ['timeScale', 'timeScale: number', 'Game speed (0.25 = slow motion).'],
  ['gravityFlipped', 'gravityFlipped: boolean', 'True while gravity is flipped.'],
  ['levelNumber', 'levelNumber: number', 'The level set by setLevel(); a level restart keeps it.'],
  ['tune', "tune(name, value, { min, max, step, label, live, for })", 'Declares a dial (if new) and returns its current value.'],
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
  ['level', "level(rows, { tile, legend })", "A level from text rows ('#' is ground)."],
  ['platform', "platform(x, y, w, h?, key = 'ground', { oneWay })", 'A solid platform tiled with a terrain drawing.'],
  ['chunks', 'chunks({ size, start, make(x0, index) })', 'An endless world built just ahead of the camera.'],
  ['flipGravity', 'flipGravity(): 1 | -1', 'Flips gravity for everything.'],
  ['portal', 'portal(a, b, { color, key })', 'Two portals that swap whatever touches them.'],
  ['win', "win(text = 'YOU WIN!')", 'Ends the level as a win (confetti, score, play again).'],
  ['lose', "lose(text = 'OH NO!')", 'Ends the level as a loss.'],
  ['restart', 'restart()', 'Starts the level again: create() runs anew, with this.levelNumber kept.'],
  ['setLevel', "setLevel(n, title?)", 'Sets and announces level n; then this.restart() builds it.'],
  ['addScore', 'addScore(n, x?, y?): number', 'Adds combo-multiplied points and pops "+n".'],
  ['highScore', 'highScore(): number', 'The best score saved with the game.'],
  ['setHighScore', 'setHighScore(n)', 'Saves a best score.'],
  ['sfx', "sfx(name | segments, { volume, pitch })", 'Plays a synth sound (coin, jump, laser, explosion...) or a recorded one.'],
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
  ['play', "play(move, { once, lock })", 'Plays a move: idle walk run jump attack shoot hurt die cheer rage fly swim wiggle spin...'],
  ['face', 'face(dir)', 'Turns left (-1) or right (1).'],
  ['lookAt', 'lookAt(target | null)', 'Keeps turning toward a target.'],
  ['attach', "attach(obj, 'head' | 'hat' | 'hand' | 'back' | 'feet')", 'Characters carry something (a hat, a wand).'],
  ['setArt', 'setArt(key)', 'Characters turn into another drawing.'],
  ['ghost', 'ghost(color?)', 'Characters leave an afterimage.'],
  ['ragdoll', 'ragdoll({ break })', 'Characters fall apart into their drawn parts, pinned at the joints (Matter games).'],
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

const TWISTS_NS: Table = [
  ['isOn', 'isOn(id): boolean', 'Is this twist switched on?'],
  ['list', 'list: string[]', 'The twists switched on.'],
];

/** Phaser's own Scene members that game code uses on `this`. */
const PHASER_SCENE = [
  'sys', 'game', 'anims', 'cache', 'registry', 'sound', 'textures', 'events', 'cameras', 'add', 'make', 'scene', 'children', 'lights',
  'data', 'input', 'load', 'time', 'tweens', 'physics', 'matter', 'scale', 'plugins', 'renderer', 'init', 'preload', 'create', 'update',
];

/** Scene properties the kit owns: game code must not assign them. */
const RESERVED = ['fx', 'ui', 'controls', 'music', 'combo', 'pattern', 'twists', 'dials', 'dial', 'clock', 'gravityFlipped', 'levelNumber'];

const NAMESPACES = { fx: FX, ui: UI, controls: CONTROLS, music: MUSIC, combo: COMBO, pattern: PATTERN, twists: TWISTS_NS } as const;

export type KitNamespace = keyof typeof NAMESPACES;

export interface KitApi {
  version: string;
  /** Globals game code may use besides the language and browser built-ins. */
  globals: string[];
  /** Everything on `this` in a scene (kit and Phaser), plus `ns.member` entries for the kit namespaces. */
  sceneMethods: string[];
  namespaces: Record<KitNamespace, string[]>;
  /** Members of spawned things (behaviours, health, moves). */
  actorMethods: string[];
  /** Names models invent for scene members, mapped to the kit's (`spawnPlayer` -> `spawnHero`). */
  synonyms: Record<string, string>;
  /** The same per namespace (`fx.screenShake` -> `fx.shake`); the runtime resolves these too. */
  namespaceSynonyms: Record<KitNamespace, Record<string, string>>;
  reserved: string[];
  /** Signatures and one-line docs. */
  docs: { scene: KitMember[]; actor: KitMember[] } & Record<KitNamespace, KitMember[]>;
  sounds: string[];
  musicStyles: string[];
  moves: string[];
  twists: Array<{ id: string; name: string; does: string }>;
  actions: string[];
  artKinds: string[];
  rigKinds: string[];
  roles: string[];
  shapes: string[];
}

function build(): KitApi {
  const namespaces = Object.fromEntries(Object.entries(NAMESPACES).map(([ns, t]) => [ns, t.map(([n]) => n)])) as Record<KitNamespace, string[]>;
  const sceneKit = SCENE.map(([n]) => n);
  const nsEntries = Object.entries(namespaces).flatMap(([ns, list]) => list.map((m) => `${ns}.${m}`));
  return {
    version: '2.0.0',
    globals: ['Amble', 'Phaser', 'localStorage', 'sessionStorage'],
    sceneMethods: [...new Set([...PHASER_SCENE, ...sceneKit, ...nsEntries])],
    namespaces,
    actorMethods: ACTOR.map(([n]) => n),
    synonyms: { ...SCENE_SYNONYMS },
    namespaceSynonyms: Object.fromEntries(
      Object.entries(namespaces).map(([ns, list]) => [ns, Object.fromEntries(Object.entries(NAMESPACE_SYNONYMS).filter(([alias, real]) => list.includes(real) && !list.includes(alias)))]),
    ) as Record<KitNamespace, Record<string, string>>,
    reserved: [...RESERVED],
    docs: {
      scene: members(SCENE),
      actor: members(ACTOR),
      fx: members(FX),
      ui: members(UI),
      controls: members(CONTROLS),
      music: members(MUSIC),
      combo: members(COMBO),
      pattern: members(PATTERN),
      twists: members(TWISTS_NS),
    },
    sounds: [...SOUND_NAMES],
    musicStyles: [...MUSIC_STYLES],
    moves: [...CLIP_NAMES],
    twists: TWISTS.map((t) => ({ id: t.id, name: t.name, does: t.does })),
    actions: [...ACTIONS],
    artKinds: [...ART_KINDS],
    rigKinds: [...RIG_KINDS],
    roles: [...ROLES],
    shapes: [...ART_SHAPES],
  };
}

export const KIT_API: KitApi = build();

/** One member in the reference shape: `kind` from its signature, `signature` as written in the docs. */
export interface KitReferenceMember {
  name: string;
  kind: 'method' | 'property' | 'namespace';
  signature: string;
  doc: string;
}

export interface KitReferenceNamespace {
  /** '' for members of `this` (the scene), else 'fx', 'ui', 'pattern'... */
  name: string;
  doc: string;
  members: KitReferenceMember[];
}

/**
 * The kit's scene API as a list of namespaces (the app barrel's `KitApi` shape, for cheat sheets, hover
 * docs and autocomplete): the scene's own members first (name ''), then one entry per kit namespace.
 * Members of spawned things are in `KIT_API.docs.actor`.
 */
export interface KitReference {
  version: string;
  namespaces: KitReferenceNamespace[];
}

function reference(api: KitApi): KitReference {
  const nsNames = new Set<string>(Object.keys(NAMESPACES));
  const toMember = (m: KitMember): KitReferenceMember => ({
    name: m.name,
    kind: nsNames.has(m.name) ? 'namespace' : /\(/.test(m.sig) ? 'method' : 'property',
    signature: m.sig,
    doc: m.doc,
  });
  const sceneDoc = (name: string): string => api.docs.scene.find((m) => m.name === name)?.doc ?? '';
  return {
    version: api.version,
    namespaces: [
      { name: '', doc: 'Members of `this` in a Game scene.', members: api.docs.scene.map(toMember) },
      ...(Object.keys(NAMESPACES) as KitNamespace[]).map((ns) => ({ name: ns, doc: sceneDoc(ns), members: api.docs[ns].map(toMember) })),
    ],
  };
}

export const KIT_REFERENCE: KitReference = reference(KIT_API);
