/**
 * The kit's API docs from §5.16, for hover docs and autocomplete until the player core's `KIT_API`
 * reaches the barrel (src/cores/play.ts). Same shape as `KIT_API`; unused once that has namespaces.
 */
import type { KitApi, KitMember, KitNamespace } from '../../../cores/play';

type Row = readonly [name: string, signature: string, doc: string];

function ns(name: string, doc: string, rows: readonly Row[]): KitNamespace {
  const members: KitMember[] = rows.map(([n, signature, d]) => ({ name: n, kind: signature.includes('(') ? 'method' : 'property', signature, doc: d }));
  return { name, doc, members };
}

const SCENE: Row[] = [
  ['fx', 'fx: Fx', 'Juice: shake, hitstop, slowmo, flash, burst, explode, squash, trail and more.'],
  ['ui', 'ui: Ui', 'The screen text: big titles, hints, score, hearts, boss bars, speech bubbles.'],
  ['controls', 'controls: Controls', 'Keys, touch buttons and gamepads as actions: controls.x, held(), pressed().'],
  ['music', 'music: Music', 'Music made by Amble: music.play(style).'],
  ['combo', 'combo: Combo', 'A combo counter that multiplies the score.'],
  ['pattern', 'pattern: Pattern', 'Bullet patterns: ring, spread, aimed, spiral, rain, wall, laser.'],
  ['twists', 'twists: Twists', 'The twists the player switched on (read only): twists.isOn(id).'],
  ['dial', 'dial: Record<string, number>', 'Live dial values: this.dial.jump is always the current value.'],
  ['hero', 'hero: Character | null', 'The hero (set by spawnHero).'],
  ['score', 'score: number', 'The score. Changing it updates the screen.'],
  ['clock', 'clock: number', 'Game time in ms. It slows in slow motion and stops in pauses.'],
  ['timeScale', 'timeScale: number', 'How fast the whole game runs (0.25 is slow motion).'],
  ['gravityFlipped', 'gravityFlipped: boolean', 'True while gravity is upside down.'],
  ['tune', 'tune(name, value, { min, max, step, label, live, for }): number', 'Makes a dial (if it is new) and gives back its current value.'],
  ['art', 'art(key): string', 'The picture for an art key: the drawing, or its just-bones stand-in.'],
  ['hasArt', 'hasArt(key): boolean', 'Has this one been drawn yet? (for spare cast members)'],
  ['spawn', 'spawn(x, y, key, o?): Character', 'Makes anything from an art key. Characters get bones, everything gets health.'],
  ['spawnHero', "spawnHero(x, y, key = 'hero', o?): Character", 'Makes the hero: it has health, lands on platforms and takes hits.'],
  ['spawnEnemy', "spawnEnemy(x, y, key = 'enemy', o?): Character", 'Makes an enemy in the enemies group.'],
  ['all', 'all(group): Character[]', "Everyone still active in a group ('enemies', 'items' or your own)."],
  ['group', 'group(name, o?): Group', 'A named group, made the first time you use it.'],
  ['shoot', 'shoot(from, angleOrTarget?, o?): Sprite | null', 'Fires a shot. Angles are in degrees: 0 is right, 90 is down.'],
  ['collide', 'collide(a, b, (a, b) => {})', 'Makes things bump into each other, and runs your code when they do.'],
  ['overlap', 'overlap(a, b, (a, b) => {})', 'Runs your code when things touch, without bumping.'],
  ['every', 'every(ms, fn): TimerEvent', 'Runs fn again and again, every ms of game time.'],
  ['after', 'after(ms, fn): TimerEvent', 'Runs fn once, after ms of game time.'],
  ['wait', 'wait(ms): Promise<void>', 'Waits ms of game time: await this.wait(500).'],
  ['cooldown', 'cooldown(name, ms): boolean', 'True at most once every ms for a name.'],
  ['brain', 'brain(obj, { state: { time, next, enter, update, exit } }, start?)', 'A plan of states for enemies and bosses: attack, rest, attack again.'],
  ['phases', 'phases(obj, [{ at, name, sub, enter }])', 'Boss phases that start when its health drops to a fraction.'],
  ['waves', 'waves([{ count, every, title, spawn }], { between, onWave, onClear })', 'Waves of enemies, one after another.'],
  ['follow', 'follow(obj, { lerp, lockY, offsetX, deadzone, lookahead })', 'The camera follows something.'],
  ['worldSize', 'worldSize(w, h)', 'How big the world is (for the camera and physics).'],
  ['parallax', "parallax([{ draw: 'stars' | 'hills' | 'clouds' | 'city', factor, y, height }])", 'Scenery layers that scroll at different speeds.'],
  ['weather', "weather('rain' | 'snow' | 'embers' | 'bubbles', { amount })", 'Weather over the whole screen.'],
  ['level', "level(rows, { tile, legend })", "A level made from rows of text ('#' is ground)."],
  ['platform', "platform(x, y, w, h?, key = 'ground', { oneWay })", 'A solid platform covered with a ground drawing.'],
  ['chunks', 'chunks({ size, start, make(x0, index) })', 'A world that never ends, built just ahead of the camera.'],
  ['flipGravity', 'flipGravity(): 1 | -1', 'Turns gravity upside down for everything.'],
  ['portal', 'portal(a, b, { color, key })', 'Two portals that swap whatever touches them.'],
  ['win', "win(text = 'YOU WIN!')", 'Ends the level as a win, with confetti.'],
  ['lose', "lose(text = 'OH NO!')", 'Ends the level as a loss.'],
  ['restart', 'restart()', 'Starts the level again.'],
  ['addScore', 'addScore(n, x?, y?): number', 'Adds points (times the combo) and pops "+n" on screen.'],
  ['highScore', 'highScore(): number', 'The best score, saved with the world.'],
  ['setHighScore', 'setHighScore(n)', 'Saves a new best score.'],
  ['sfx', "sfx(name, { volume, pitch })", 'Plays a sound: coin, jump, laser, explosion, roar and more.'],
  ['rand', 'rand(a?, b?): number', 'A random number between a and b.'],
  ['pick', 'pick(list)', 'A random thing from a list.'],
  ['chance', 'chance(p): boolean', 'True with chance p (0.5 is half the time).'],
  ['dist', 'dist(a, b): number', 'How far apart two points are.'],
  ['angleTo', 'angleTo(a, b): number', 'The angle from a to b, in degrees (0 is right, 90 is down).'],
  ['blast', 'blast(x, y, { radius, power })', 'Pushes everything near (x, y) away.'],
  ['box', 'box(x, y, w, h, { key, bounce, static })', 'A box that falls and tumbles.'],
  ['ball', 'ball(x, y, r, { key, bounce })', 'A ball that rolls and bounces.'],
  ['stack', 'stack(x, y, cols, rows, { w, h, key })', 'A stack of boxes to knock over.'],
  ['pyramid', 'pyramid(x, y, rows, { w, h, key })', 'A pyramid of boxes.'],
  ['wreckingBall', 'wreckingBall(ax, ay, { length, radius, angle, key })', 'A heavy ball on a chain.'],
  ['ragdoll', "ragdoll(x, y, key, { scale })", "A floppy ragdoll made from a character's own drawing."],
  ['grab', 'grab({ stiffness })', 'Lets you drag things with the mouse or a finger.'],
  ['impacts', 'impacts({ speed })', 'Sparks and thuds when things hit hard.'],
  ['stats', 'stats(): Stats', 'Numbers about the running game.'],
  ['create', 'create()', 'Runs once when the level starts: make your world here.'],
  ['update', 'update(time, delta)', 'Runs every frame, about 60 times a second.'],
  ['preload', 'preload()', 'Runs before create(). Amble loads your drawings for you.'],
];

const FX: Row[] = [
  ['shake', 'shake(intensity?, ms?)', 'Shakes the camera: 0.005 is small, 0.03 is huge.'],
  ['hitstop', 'hitstop(ms?)', 'Freezes the world for a moment (40-150 ms) so hits feel strong.'],
  ['slowmo', 'slowmo(scale?, ms?)', 'Slow motion that eases back to normal.'],
  ['flash', 'flash(color?, ms?, alpha?)', 'Flashes the screen (at most 3 times a second).'],
  ['punch', 'punch(amount?, ms?)', 'A quick camera zoom kick.'],
  ['chroma', 'chroma(amount?, ms?)', 'Splits the colours for a moment.'],
  ['burst', 'burst(x, y, { color, count, speed })', 'A burst of particles.'],
  ['explode', 'explode(x, y, { size, color, push, damage })', 'An explosion that can push and hurt things.'],
  ['shockwave', 'shockwave(x, y, { radius, color })', 'A ring that grows out from a point.'],
  ['dust', 'dust(obj, { count })', 'A puff of dust at something’s feet.'],
  ['squash', 'squash(obj, sx?, sy?, ms?)', 'Squashes and stretches something for a moment.'],
  ['trail', 'trail(obj, { color, life })', 'A trail that follows something.'],
  ['ghost', 'ghost(obj, color?)', 'Leaves a fading copy behind.'],
  ['hurtFlash', 'hurtFlash(obj, ms?)', 'Flashes something white when it gets hurt.'],
  ['halo', 'halo(obj, color?, size?)', 'A glow around something.'],
  ['lightning', 'lightning(x1, y1, x2, y2, { color, width })', 'A lightning bolt between two points.'],
  ['confetti', 'confetti(count?)', 'Confetti over the whole screen.'],
  ['vignette', 'vignette(strength?)', 'Darkens the edges of the screen.'],
  ['desaturate', 'desaturate(amount?, ms?)', 'Drains the colour out for a moment.'],
  ['motion', 'motion: number', '1, or 0.25 when the player wants less motion.'],
];

const UI: Row[] = [
  ['text', 'text(x, y, str, { size, color })', 'Text that stays on the screen.'],
  ['big', 'big(str, { sub, color, ms })', 'A big title in the middle of the screen, like "PHASE 2!".'],
  ['pop', 'pop(x, y, str, { color, rise })', 'Text that pops up and floats away.'],
  ['hint', 'hint(str, ms?)', 'A short hint at the bottom of the screen.'],
  ['score', 'score(): Text', 'Shows the score.'],
  ['setScore', 'setScore(v)', 'Sets the score on the screen.'],
  ['hearts', 'hearts(obj): Bar', 'Hearts that show how much health something has.'],
  ['bossBar', 'bossBar(obj, name?, { color, width })', "A boss's health bar at the top of the screen."],
  ['bar', 'bar(obj, { width, color, follow })', 'A small health bar, often above a character.'],
  ['say', 'say(obj, str, ms?)', 'A speech bubble.'],
  ['dialogue', 'dialogue(lines): Promise<void>', 'Lines of talking. Space or a tap goes to the next one.'],
  ['button', 'button(x, y, label, onClick)', 'A button in the game.'],
  ['timer', 'timer(seconds, onDone?)', 'A countdown timer.'],
  ['panel', 'panel(lines, { top, gap })', 'A panel of text lines.'],
];

const PATTERN: Row[] = [
  ['ring', 'ring(from, { key, count, speed })', 'Shots in a circle all around.'],
  ['spread', 'spread(from, angle, { key, count, arc })', 'A fan of shots.'],
  ['aimed', 'aimed(from, target, { count, arc })', 'Shots aimed at a target.'],
  ['spiral', 'spiral(from, { arms, turn, every, duration })', 'Shots that spin out in a spiral.'],
  ['rain', 'rain({ key, count })', 'Shots that fall from the sky.'],
  ['wall', 'wall(from, angle, { count, gap, hole })', 'A wall of shots with a hole to dodge through.'],
  ['laser', 'laser(from, angle, { warn, duration, sweep })', 'A laser beam, always with a warning first.'],
];

const MUSIC: Row[] = [
  ['play', "play(style?, { bpm })", "Plays music: 'boss', 'adventure', 'chase', 'chill', 'spooky' or 'chaos'."],
  ['intensity', 'intensity(level)', 'Makes the music calmer (0) or more exciting (2).'],
  ['stop', 'stop()', 'Stops the music.'],
];

const COMBO: Row[] = [
  ['count', 'count: number', 'Hits in the current combo.'],
  ['best', 'best: number', 'The biggest combo so far.'],
  ['window', 'window: number', 'How long (ms) you have to keep the combo going.'],
  ['mult', 'mult: number', 'The score multiplier right now.'],
  ['hit', 'hit(x?, y?): number', 'Adds a hit to the combo.'],
  ['reset', 'reset()', 'Ends the combo.'],
];

const CONTROLS: Row[] = [
  ['x', 'x: number', 'Left and right, from -1 to 1.'],
  ['y', 'y: number', 'Up and down, from -1 to 1.'],
  ['left', 'left: boolean', 'True while left is held.'],
  ['right', 'right: boolean', 'True while right is held.'],
  ['up', 'up: boolean', 'True while up is held.'],
  ['down', 'down: boolean', 'True while down is held.'],
  ['jump', 'jump: boolean', 'True while jump is held.'],
  ['fire', 'fire: boolean', 'True while fire is held.'],
  ['dash', 'dash: boolean', 'True while dash is held.'],
  ['action', 'action: boolean', 'True while the action key is held.'],
  ['held', 'held(action): boolean', 'True while an action is held.'],
  ['pressed', 'pressed(action): boolean', 'True once, right when an action is pressed.'],
  ['released', 'released(action): boolean', 'True once, right when an action is let go.'],
  ['pointer', 'pointer: { x, y, down, justDown }', 'Where the mouse or finger is in the world.'],
];

const TWISTS: Row[] = [
  ['isOn', 'isOn(id): boolean', 'Is this twist switched on?'],
  ['list', 'list: string[]', 'The twists that are switched on.'],
];

const ACTOR: Row[] = [
  ['platformer', 'platformer({ speed, jump, jumps, dash, stomp })', 'Runs and jumps, with double jumps and dashes.'],
  ['runner', 'runner({ speed, maxSpeed, speedUp, jump })', 'Runs right by itself and speeds up.'],
  ['topdown', 'topdown({ speed })', 'Moves in 8 directions, with no gravity.'],
  ['flyer', 'flyer({ speed, lift, glide })', 'Flaps up with jump and glides down.'],
  ['shooter', "shooter({ key, every, speed, aim })", 'Fires shots while fire is held.'],
  ['patrol', 'patrol(speed?, { min, max })', 'Walks back and forth.'],
  ['chase', 'chase(target, speed?)', 'Moves toward a target.'],
  ['wander', 'wander({ speed, radius })', 'Wanders around its home.'],
  ['orbit', 'orbit(center, radius, speed?)', 'Circles around a point.'],
  ['jump', 'jump(velocity?)', 'Jumps once.'],
  ['damage', 'damage(n?, { from, knockback }): boolean', 'Hurts it, with a flash and a knockback.'],
  ['heal', 'heal(n?)', 'Gives back health.'],
  ['kill', 'kill()', 'Defeats it right away.'],
  ['play', 'play(move, { once, lock })', 'Plays a move: walk, run, jump, attack, hurt, cheer, wave...'],
  ['face', 'face(dir)', 'Turns to face left (-1) or right (1).'],
  ['lookAt', 'lookAt(target | null)', 'Keeps turning toward a target.'],
  ['attach', "attach(obj, 'head' | 'hand' | 'back' | 'feet')", 'Carries something, like a hat or a wand.'],
  ['setArt', 'setArt(key)', 'Turns into another drawing.'],
  ['ghost', 'ghost(color?)', 'Leaves a fading copy behind.'],
  ['ragdoll', 'ragdoll(): Ragdoll', 'Falls apart into its drawn pieces.'],
  ['hp', 'hp: number', 'Health.'],
  ['maxHp', 'maxHp: number', 'Full health.'],
  ['alive', 'alive: boolean', 'False once it is defeated.'],
  ['invincible', 'invincible: boolean', 'It cannot be hurt while this is true.'],
  ['points', 'points: number', 'Score you get for defeating it.'],
  ['contactDamage', 'contactDamage: number', 'Damage it does when it touches the hero (0 is harmless).'],
  ['facing', 'facing: 1 | -1', 'Which way it faces: 1 is right, -1 is left.'],
  ['onGround', 'onGround: boolean', 'True while it stands on something.'],
  ['drawn', 'drawn: boolean', 'False while it is still just bones.'],
];

export const KIT_FALLBACK: KitApi = {
  version: 'spec-5.16',
  namespaces: [
    ns('', 'The scene your Game class builds on (this).', SCENE),
    ns('fx', 'Juice that makes hits and jumps feel good.', FX),
    ns('ui', 'Text and bars on the screen.', UI),
    ns('pattern', 'Bullet patterns.', PATTERN),
    ns('music', 'Music made by Amble.', MUSIC),
    ns('combo', 'The combo counter.', COMBO),
    ns('controls', 'Keys, touch and gamepad.', CONTROLS),
    ns('twists', 'The twists that are on.', TWISTS),
    ns('actor', 'What spawned characters can do.', ACTOR),
  ],
};
