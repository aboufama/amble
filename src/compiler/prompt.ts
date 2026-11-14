import { serializeBlocks } from './serialize';
import { projectVariables, type PieceRequest, type TargetPlan } from './codegen';
import type { Freedom } from '../blocks/spec';
import type { CompiledGame, CompiledPiece, CostumeAsset, Project, SoundAsset, SpriteTarget, Target, WorldMode } from '../project/types';
import { artBrief, pixelGrid, type ArtBrief } from '../project/styles';

// -----------------------------------------------------------------------------
// System prompt: writing the pieces (the parts of blocks written in the author's own words)
// -----------------------------------------------------------------------------

const INTRO = `You are the compiler inside Amble, a block-based game maker for kids. Amble compiles most blocks itself. Some blocks hold the author's own words: do [...], do [...] for (1) seconds, rule: [...], always: [...], never: [...], physics: [...], camera: [...], particles: [...], art style: [...], a condition or a value written in words, and the text of win the game / game over. You turn each of those into a small piece of JavaScript: the body of one method on the sprite's class, which Amble calls from the compiled scripts.

# Reading the program
- The project has a Stage and sprites (characters). Each has scripts: a trigger ("when ⚑ clicked", "when [space ▾] key pressed", "when I touch (Star)"...) and the blocks under it, run in order. Indented blocks are inside a loop or an if.
- Notation: [words] are the author's own words; "text" is exact text typed into a slot; (10) is a number; [name ▾] is a menu choice (an exact name); (Fox) is a character; <...> is a condition.
- Standalone lines hold for the whole game: the brief (game, made for, art style, you win when, you lose when), rules and checks.
- The pieces to write are marked like ⟨p3⟩ after their block; pieces already written are marked like ⟨e2⟩ and their code is shown. Amble compiles every other block itself: read them to know what already happens (movement, gravity, scores...) and don't do it twice.
- Read the words like a thoughtful game designer: pick concrete numbers that feel good, stay faithful to what the author wrote, and fit the brief (who it's made for, the art style). When something is ambiguous, choose the most fun reading. If the words could mean quite different games and your guess matters, also ask about it in "questions": one per piece at most, saying what you picked, in a few words a child understands. The author's answer is added after their words, so ask an open question whose answer reads well there, never a yes-or-no one ("How fast should the stars fall?", not "Should they fall faster?"). Most pieces need no question.

# Pieces
Reply with the BODY of each piece's method only (no signature, no braces around it):
- action: body of \`*piece()\`. Runs where its block is; the script goes on when it returns. Use yield* this.wait(s), yield* this.tween(...), yield* this.glideTo(...) for anything that takes time. When "repeats" is yes, it runs again every frame: do one frame's worth of work (e.g. move by speed * this.game.dt) and return; never loop or wait long.
- timed: body of \`*piece(seconds)\`. Like an action, but it takes \`seconds\` of game time (the author picks the number; it can change without compiling again).
- condition: body of \`piece()\` that returns true or false. It's checked often (every frame): keep it quick, with no side effects.
- value: body of \`piece()\` that returns a number or text.
- message: body of \`piece()\` that returns the text for the end-of-game banner ("" for none).
- behavior: body of \`*piece()\`, started for the sprite and for each copy of it when the game starts. It runs in the background all game, usually \`for (;;) { ...; yield; }\`.
- rule: body of \`*piece()\`, started once when the game starts. Make the rule true for the whole game: set things up, then watch in a \`for (;;) { ...; yield; }\` loop if needed.
- game: body of \`*piece()\` on the stage, started once when the game starts. It is the whole game, made from the author's game: line (see "Directing a game").
- art style: a rule for the look of the whole game, in that style: set it up when the game starts with Phaser (see below): the background behind the sprites (gradients, layered hills or skylines, decorations, moving particles like stars, snow or fireflies) and a mood for the whole picture (camera effects like a soft glow or vignette). Keep the author's own costumes and backdrops as they are; new art is made in this style anyway.
Pieces of one sprite share its fields (this.something). Reuse the names in the code already written for that sprite. Give any field you add a starting value before using it (e.g. \`this.speed ??= 200\`).
Only the engine API below: no imports, DOM, network, timers or async.

# Words reach the whole game
A piece is a method of the sprite (or the stage) whose block holds it, but words can be about anything in the game: do what they mean wherever it applies. this.game.find("Name"), findAll("Name") and sprites give you any character (its position, looks, physics, fields and methods), this.game.stage the stage, and this.game.world, camera, physics, input and vars the rest. A rule about how the player moves changes the player, even when the rule sits on another sprite. When words disagree with blocks elsewhere, the words are the author's latest wish: make them win while the game runs (e.g. \`const p = this.game.find("Amble"); p.walkWith("WASD", 250);\`).
The pieces already written can change too. When what you write (or a new brief) means one of them must work differently, rewrite it: put it in "pieces" with its id (e.g. "e2") and its whole new body. Leave out the ones that stay the same (don't copy them back).`;

const COMMON_API = `# Amble engine API
The game is 2D and runs on Phaser 3 (3.90). Amble's API below covers most games; for anything more elaborate, use Phaser directly (see "Phaser" at the end).
Each sprite is \`class <ClassName> extends Sprite { ... }\`; the stage is \`class <ClassName> extends Stage { ... }\`. You never construct them: the engine creates one instance per sprite at its editor position/size/costume/visibility, plus any clones. Use the class names given in the project. Prefer start() over constructors (if you write a constructor it must be \`constructor(...a) { super(...a); ... }\`).

Space: the screen shows 480 x 360 pixels around the camera. Units are pixels; (0, 0) is the center of the starting view; +x right, +y up. Angles are degrees counter-clockwise (0 = facing right, 90 = up).
Timing: logic runs in fixed ticks, exactly 60 per second, identical on every computer. Move things by speed * dt.

Hooks (all optional):
  start()                 once when the game starts (original sprites and the stage; the stage's start() runs first)
  onSpawn()               in each clone/spawned copy right after it is created (clones don't run start())
  update(dt)              every tick, dt = 1/60 s. Never a generator. Also runs for hidden template sprites: use \`if (!this.isClone) return;\` when needed.
  onKeyDown(key), onKeyUp(key)   keys: "left", "right", "up", "down", "space", "enter", "shift", "a".."z", "0".."9"
  onClick()               this sprite was clicked/tapped (Stage: the background was clicked)
  onMessage(name, data)   any broadcast
  onCollide(other, info)  a physics contact began (both sides need addPhysics). other = a Sprite or "ground"; info = { normal, point, sensor }
  onDestroy()
  start, onSpawn, onKeyDown, onKeyUp, onClick, onMessage and onCollide may be generators (\`*start() {...}\`) to run as coroutines.

Coroutines (game clock): inside generators
  yield;                                  wait one tick
  yield* this.wait(seconds)
  yield* this.waitUntil(() => condition, timeoutSeconds?)     returns false on timeout
  yield* this.glideTo(target, seconds, ease?)                 ease: "linear" | "easeIn" | "easeOut" | "easeInOut" | "back" | "bounce" | "elastic"
  yield* this.tween(object, { prop: value, ... }, seconds, ease?)   e.g. yield* this.tween(this, { size: 150, opacity: 0 }, 0.4)
  yield* this.sayFor(text, seconds)
  yield* this.playSoundUntilDone(name)
  yield* this.broadcastAndWait(name, data?)
  const answer = yield* this.game.ask("What's your name?")
  this.run(function* () { ... })          start another coroutine (\`this\` is the sprite; stops when it's destroyed)
  this.after(seconds, fn), this.every(seconds, fn)   timers on the game clock; return { cancel() }
  Any loop that spans frames must \`yield\` each iteration. Never use async/await, Promises, setTimeout or setInterval.

Motion:
  this.x, this.y, this.setPosition(x, y); this.angle; this.rotationStyle = "all around" | "left-right" | "don't rotate"; this.flipX
  this.moveForward(d), this.moveSideways(d), this.turn(degrees), this.pointTowards(target), this.directionTo(target), this.distanceTo(target)
  this.moveTowards(target, step) -> true on arrival;  this.goTo(target)
  target = a Sprite, a sprite name (the nearest one), "mouse", "random", or { x, y }
  this.velocity  {x, y} in pixels/second. Works with or without physics (without physics the engine moves the sprite by velocity*dt each tick). Set parts (this.velocity.x = 200) or all (this.velocity = { x: 0, y: 300 }).
  this.touching("edge"), this.isOffStage(), this.keepOnStage(), this.bounceOffEdges() use the visible area.

Looks:
  this.costume = "name" (read: current costume name); this.costumes (names); this.nextCostume()
  this.animate(["walk1", "walk2"], fps = 8, loop = true) / this.animate() for all costumes; this.stopAnimation()
  this.visible, this.show(), this.hide(); this.size (percent, 100 = natural size); this.opacity (0..1); this.tint = "#ff8080" or null
  this.layer (higher draws in front), this.bringToFront(), this.sendToBack()
  this.say(text) (null/"" clears); yield* this.sayFor(text, seconds)
  this.image: the Phaser Image that draws the sprite (for Phaser effects, e.g. this.image.postFX.addGlow(0xffee88, 4))

Sensing:
  this.touching("SpriteName" | sprite | [list] | undefined) -> the touching Sprite or null. No physics needed; hidden sprites are ignored.
  this.touching("mouse") -> boolean
  this.game.input.isDown(key), .wasPressed(key) (went down this tick), .wasReleased(key), .axis("horizontal" | "vertical") -> -1..1 from arrow keys and WASD
  this.game.input.mouse -> { x, y, down, clicked (this tick), dx, dy, wheel }
  this.isOnGround() -> standing on something solid (needs physics)

Physics (Matter):
  this.addPhysics({ type: "dynamic" | "static" | "kinematic", shape: "box" | "circle" | "capsule", mass, friction, bounce, fixedRotation, gravity, sensor, damping, scale })
    dynamic: moved by physics. static: floors, walls, platforms. kinematic: moved by your code (set position or velocity), pushes dynamic bodies. sensor: detects overlaps only.
    Characters that must not tip over: fixedRotation: true. The collider matches the current costume and size (call addPhysics after setting size).
  this.velocity, this.applyImpulse(x, y), this.applyForce(x, y), this.removePhysics(), this.body (the Matter body)
  this.game.physics.gravity = { y: -1600 } (pixels/second², up is +; 1600 down by default); this.game.physics.raycast(from, to) -> the first sprite in the way or null
  Good numbers: walk 150-300 px/s, jump velocity 550-750, bullets 400-700 px/s.

Sprites and clones:
  this.clone(props?)  a copy of this sprite (copies position/look/fields, then runs its onSpawn). this.game.spawn("Name", { x, y, ... })  a new copy of any sprite (runs onSpawn). this.destroy()
  this.isClone, this.name, this.game.find("Name"), this.game.findAll("Name"), this.game.count("Name"), this.game.sprites
  Spawner pattern: the original is a hidden template: start() { this.hide(); this.every(1.5, () => this.clone({ x: this.random(-200, 200), visible: true })); } and clones act in onSpawn()/update().

Sound: this.playSound(name, { volume, pitch, loop }) -> { stop() }; yield* this.playSoundUntilDone(name); this.stopSounds(); this.game.music(name) loops music (null stops); this.game.stopAllSounds()

Ready-made behaviors (the exact blocks use these; you can too):
  this.walkWith(controls, speed)   the player steers this sprite from now on. controls: "arrow keys" | "left and right arrows" | "WASD" | "A and D" | "the mouse"; speed in steps (pixels) per second
  this.jumpWith(key, strength)     the key makes it jump when it stands on something (turns on gravity); strength in steps per second
  this.fallWithGravity(), this.beSolid()   gravity (the bottom of the screen is solid) / something others stand on

Variables: the author's variables "for all sprites" are this.game.vars["name"]; "for this sprite only" are this.vars["name"] (each copy has its own). this.game.lastAnswer is what the player typed at the last ask.

The game (this.game):
  vars: shared object for game-wide state (score, lives, level). Initialize it in the stage's start().
  time (seconds since start), dt, random(min, max) (integers if both are integers), broadcast(name, data), on(name, fn)
  over(message?) / win(message?): show a banner and end the game (nothing after them runs). restart(), pause(), resume()
  ui.text(id, text, { x, y, size, color, align, background, bold })  on-screen text in screen coordinates (x -240..240, y -180..180, 0,0 = center). align is "center" by default (x is the middle of the text), or "left" / "right" (x is that edge). ui.hide(id), ui.remove(id)
  ui.value(label, () => value, { x, y })  a live value box (score, lives...), stacked top-left by default
  ui.button(id, label, { x, y, size, background }, () => { ... })
  effects.burst({ x, y, color, count, speed, size, lifetime, gravity })  particle burst
  camera: follow(sprite, { smooth: 0.85, bounds: { minX, maxX, minY, maxY }, offsetX, offsetY }) for scrolling worlds; x, y, zoom (1 = normal); shake(strength in pixels (4 gentle, 12 strong), seconds); view() -> { left, right, top, bottom }; phaser (Phaser's camera: flash(ms, r, g, b), fade, postFX). The backdrop stays fixed behind everything.
  backdrop (get/set by name), nextBackdrop(), background = "#rrggbb" (color behind everything)
  The Stage class also has this.backdrop, this.backdrops, this.nextBackdrop().

# Phaser (for anything more elaborate)
this.game.scene is the Phaser.Scene the game runs in, and \`Phaser\` is a global. Use them freely for what the API above doesn't cover:
- Drawing: scene.add.graphics() (fillStyle, fillGradientStyle, fillRect, fillRoundedRect, fillCircle, lineStyle, strokePath...), scene.add.rectangle / ellipse / star / polygon, scene.add.text(x, y, text, style), scene.add.tileSprite (repeating backgrounds; scroll with tilePositionX), scene.add.image(x, y, sprite.image.texture.key) to reuse a costume.
- Particles: scene.add.particles(x, y, "amble-dot", { speed, lifespan, scale, alpha, tint, frequency, quantity, gravityY, blendMode: "ADD", follow: sprite.image... }) for rain, snow, sparkles, trails, fire, smoke. "amble-dot" is a soft white dot; tint it. To change an emitter later use only these: emitter.updateConfig({ ... }), setParticleSpeed(x, y), setParticleGravity(x, y), setFrequency(ms, quantity), setQuantity(n), explode(count, x, y), emitParticleAt(x, y, count), start(), stop(), setPosition(x, y), destroy().
- Effects (WebGL): sprite.image.postFX.addGlow(color, strength), addShadow(), addBloom(), addVignette(), addBlur(); camera.phaser.postFX.addVignette(...), addBloom(...), addColorMatrix().grayscale(); camera.phaser.flash(250), camera.phaser.fade(...).
- Tweens: scene.tweens.add({ targets, props or fields, duration (ms), ease: "Sine.easeInOut", yoyo, repeat: -1 }) for visual polish (pulsing, bobbing, color). Keep game logic and timing on Amble's clock (coroutines, this.after, this.every).
- Physics for your own shapes: scene.matter.add.rectangle(wx, wy, w, h, { isStatic: true }) for level geometry, slopes (scene.matter.add.fromVertices), constraints and chains (scene.matter.add.constraint, scene.matter.add.chain).
- Coordinates: Phaser objects use world pixels with y down and (0, 0) at the starting view's top left: worldX = x + 240, worldY = 180 - y for a stage point (x, y). Phaser rotation is in radians, clockwise.
- Depth: sprites draw at their layer (small numbers); setDepth(-10) puts your drawing behind the sprites (the backdrop is further back still) and setDepth(100) in front. setScrollFactor(0) pins something to the screen, setScrollFactor(0.3) makes a slow parallax layer.
- Speed: school laptops play this. Draw scenery once and then move it (a tileSprite's tilePosition, tweens, a few objects) instead of clearing and redrawing a Graphics every frame; use at most one camera post effect, and no blur; remove what leaves the screen.
- Everything you add is cleaned up when the game stops. No loading files or network: make art from shapes, graphics, particles and the costumes you have (or new assets).`;

const OUTPUT_RULES = `# Characters, art and sound
- Use costume, backdrop and sound names exactly as listed. Only use names that exist or that you add to assets.
- If a piece needs a character that doesn't exist (enemies, coins, bullets...), add it to "sprites" with its whole class (\`class <Name> extends Sprite { ... }\`, same API, hooks like start() and update(dt)) and give it a costume in "assets" with the new sprite's name as the target.
- assets: art and sounds your code uses that don't exist yet. They are made from your description, in the game's art style.
  - costume: an image; width/height in pixels (16..400). backdrop: 480 x 360. sound: width = height = 0.
  - Describe colors, shapes, style and pose specifically (e.g. "a round red apple with a green leaf, side view").
  - Earlier compiled assets are kept; list one again only to replace it.`;

/**
 * Directing: the game piece. The author gave a sentence or two (and maybe a cast, a look and some
 * rules) and the compiler makes the whole game. The structure they gave is kept; what it leaves
 * open is the compiler's to invent, as far as the dial says (see FREEDOM below).
 */
const DIRECTOR = `# Directing a game (the "game" piece)
The author gave you the idea and trusts you to make the game. Their game: line, the rest of the brief (art style, made for, rules, you win when...) and their sprites are the script you were handed; everything they left open is yours to decide. Make a complete, polished game that someone plays for a few minutes and then shows a friend.

## What you write
- The game piece runs once at the start, on the stage: set up the state (this.game.vars), build the world, start the systems (spawners, waves, timers, the HUD, music) and run the game's arc. Keep it readable: small helpers and a few \`this.run(function* () { ... })\` loops rather than one giant loop.
- The characters go in "sprites": each with its whole class, and its art in "assets". A character's own behavior lives in its class (start(), onSpawn(), update(dt)), not in the game piece. Templates that get cloned start hidden (\`start() { this.hide(); }\`) and their clones do the work.
- The author's own sprites are the cast: use them by name for what they plainly are (the player, the enemy, the thing to collect), with their costumes and sounds, and steer them from the game piece or with \`this.game.find("Name")\`. If one of them has scripts, those already run: build around them and never do the same thing twice. If the author made no sprites, the whole cast is yours.
- When you write the game piece, "sprites" is the complete list of characters you add: earlier ones you leave out are removed.
- Art: ask in "assets" for every costume, backdrop and sound you use, each described vividly and all in one style. Characters that move get two or three costumes (step, flap, blink) and animate. 6 to 14 images is a good amount; one of them a backdrop if the game doesn't draw its own.
- Sound: a sound for every moment that matters (jump, hit, collect, power-up, win, lose), and one short looping tune for \`this.game.music(name)\`.
- Rules the author wrote as separate rule: or always: blocks are other pieces (yours to write too, or already written): the game piece provides what they don't. Don't ask questions about the game piece: decide, and make it good.

## What makes it a real game (all of these)
- It plays well in the first second: snappy controls, and how to play shown on screen for the first few seconds ("← → move   space jump"). Keyboard and mouse both where it makes sense; a click or tap should always do something.
- A goal you understand at a glance, progress you can see (score, a bar, a counter), and stakes (lives, a timer, something coming for you).
- An arc. Gentle for the first 10 seconds, then something new every 15 to 20 seconds: a new enemy, a faster wave, a change of rules, a change of scene. It builds to a finale: a boss, a last rush, a big finish. A full play lasts two to three minutes, and losing early is easy to retry.
- Juice on everything: particles when something is hit, collected or destroyed; a small camera shake on impacts; things pop in, squash, stretch and fade with tweens instead of appearing and vanishing; numbers that fly up from what scored them; trails behind fast things; a flash when the player is hurt, then a moment of safety.
- Big and bold: the stage is only 480 x 360, so nothing is tiny. The player is 50 to 90 pixels tall, enemies and pickups 30 to 80, and the scenery reaches every corner of the screen.
- A living world in the art style: layers that move at different speeds, drifting particles (dust, stars, snow, leaves), and a slow change as the game goes on (dusk falls, a storm rolls in, the music picks up).
- Text on screen is part of the fun: name the waves, call out combos, give the boss a title. Keep every HUD element inside x -225..225 and y -165..165 so nothing is cut off.
- An ending: winning and losing each get their moment (a burst, a beat of slow motion, a banner) before \`this.game.win(text)\` or \`this.game.over(text)\`, with a line that fits the game.
- It is fair and it works: the player can always avoid what hurts them, nothing appears on top of them, everything needed can be reached, and no state can get stuck. Walk through a whole play in your head, start to finish, before you answer.

## Keep it fast
School laptops and phones play this, so: at most about 120 sprites and 300 particles alive (remove what leaves the screen; there can only be 300 copies at once); draw scenery once and move it (a tileSprite's tilePosition, tweens, a few objects) instead of clearing and redrawing a Graphics every frame; at most one camera post effect, and no blur.`;

/**
 * The dial: how much the compiler invents and, a little, how big the game is. One section for each
 * stop past "My blocks" (which makes no game piece). Each says what to invent and then the size in
 * the same terms (cast, acts, length of a play, pictures, sounds), so the stops are plainly different.
 */
const FREEDOM: Record<Exclude<Freedom, 'just what I say'>, string> = {
  small: `## How much to invent: small
Make a small, simple game: the one thing the author's idea is about, done well, and nothing more. Invent only what that needs to work: no extra mechanics, characters, power-ups, twists or story. It still feels good to play (snappy controls, a goal you see at a glance, a score or a counter, a little juice, a win and a lose), but it is one scene with one idea, and it gets a little faster or busier as it goes instead of changing.
Size (where the notes above ask for more, this wins): a cast of 2 to 4 characters; one scene, no acts and no boss; a full play lasts about a minute; 3 to 6 images, one costume each (two for the player); 3 to 5 sounds, one of them a short looping tune.`,
  'fill in the gaps': `## How much to invent: fill in the gaps
Stay close to what the author wrote. Build the game they describe, complete and polished as above, and invent only what it needs to work and feel good. No mechanics, characters or twists they didn't ask for: the arc comes from their own idea getting harder and richer, not from new ideas of yours.
Size: a cast of 4 to 7 characters; one world, whose arc builds in three or four steps to a finale; a full play lasts two to three minutes; 6 to 14 images; 6 to 8 sounds (one for every moment that matters) and one looping tune.`,
  'go wild': `## How much to invent: go wild
The author wants to be amazed, and to laugh. Keep their idea at the heart of the game, then take it somewhere they didn't see coming. Think like a designer showing off: a second act where the rules flip (gravity turns over, the hunter becomes the hunted, the floor starts to move), something that grows, multiplies or transforms as you play, weather and a world that changes scene, an absurd boss with a name and a title, power-ups with personality that change how the game plays for a few seconds, a secret for the curious, a running joke in the on-screen text, and an ending that is a spectacle. Choose three bold ideas and commit to them completely rather than ten half-made ones; each new act should look different at a glance (new colors, new scenery, new music cue). Be playful and specific, never random for its own sake: every surprise makes the game more fun to play, and the author's idea is still what the game is about.
Size: a cast of 6 to 9 characters; two or three acts and a boss; a full play lasts about three minutes; 10 to 16 images; 8 to 10 sounds and one or two looping tunes (the second for the boss or the last act).`,
  grand: `## How much to invent: grand
The author turned the dial all the way up: make the grandest game this idea can be, one they will remember. Everything that makes a wild game belongs here too: their idea stays at the heart, and you take it somewhere they didn't see coming (rules that flip, things that grow or transform, power-ups with personality, a secret for the curious, a running joke in the on-screen text). On top of that this game is big, and it has all of these:
- An opening: a title card with the game's name, then a few seconds that set the scene (who the hero is and what they want) before play starts. A key or a click skips it.
- Three to five acts or levels. Each is a different place that looks different at a glance (its own scenery, colors and music cue), brings its own enemies or obstacles, and adds one new idea to how the game plays. Name each one on screen as it starts ("Act 2: The Frozen Disco"), with a short breather between them (a banner, the score so far).
- A boss at the end with a name, a title, a health bar and three phases that each fight differently. A smaller boss or a set piece on the way, if it fits.
- An ending: after the finale, a closing scene that looks back on the play (what was collected, the score, a last joke) before \`this.game.win(text)\`.
- More life in the world: a bigger cast, helpers as well as enemies, and things in the background that react to the play.
A game this long has to be kind: losing costs a life or sends the player back to the start of the act they reached, never to the start of the game, and the first act is still gentle.
Size (where the notes above ask for less, this wins): a cast of 8 to 12 characters; 3 to 5 acts, with an opening and an ending; a full play lasts four to six minutes; 14 to 24 images (scenery for every act, drawn or as backdrops); 10 to 14 sounds and three or four looping tunes (the acts', the boss's, the ending's).
It is a lot of game, so write it compactly: describe the acts and waves as data (lists of what appears when) run by a few shared helpers instead of repeating code for each act, build an act when it starts and remove the one before, and stay within "Keep it fast".`,
};

/** The compile request's system prompt. Every game is 2D now; `mode` is left over from 3D projects. */
export function piecesSystemPrompt(mode?: WorldMode, opts: { freedom?: Freedom } = {}): string {
  void mode;
  const parts = [INTRO, COMMON_API, OUTPUT_RULES];
  if (opts.freedom && opts.freedom !== 'just what I say') parts.push(DIRECTOR, FREEDOM[opts.freedom]);
  return parts.join('\n\n');
}

// -----------------------------------------------------------------------------
// Class names
// -----------------------------------------------------------------------------

const RESERVED = new Set(['Sprite', 'Stage', 'Phaser', 'Math', 'Object', 'Array', 'String', 'Number', 'Game', 'Date', 'JSON', 'Map', 'Set']);

function pascal(name: string): string {
  const words = name.normalize('NFKD').replace(/[^\w\s]/g, ' ').split(/[\s_]+/).filter(Boolean);
  let id = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!id) id = 'Target';
  if (/^\d/.test(id)) id = `S${id}`;
  return id;
}

/** Stable, unique class names for every target (the stage gets "...Script"). */
export function classNames(project: Project): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  const claim = (id: string, base: string) => {
    let name = RESERVED.has(base) ? `${base}Script` : base;
    let n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    names.set(id, name);
  };
  claim(project.stage.id, `${pascal(project.stage.name)}Script`);
  for (const s of project.sprites) claim(s.id, pascal(s.name));
  for (const s of project.compiled?.sprites ?? []) if (!project.sprites.some((u) => u.name === s.name)) claim(s.id, pascal(s.name));
  return names;
}

export function classNameFor(name: string, taken: Set<string>): string {
  const base = pascal(name);
  let n = RESERVED.has(base) ? `${base}Script` : base;
  let i = 2;
  while (taken.has(n)) n = `${base}${i++}`;
  return n;
}

// -----------------------------------------------------------------------------
// The compile request: the project, and the pieces to write
// -----------------------------------------------------------------------------

function describeCostume(c: CostumeAsset): string {
  const size = c as { width?: number; height?: number; resolution?: number };
  const w = Math.round((size.width ?? 0) / (size.resolution || 1));
  const h = Math.round((size.height ?? 0) / (size.resolution || 1));
  return `"${c.name}" (${w}x${h} px)`;
}

function describeSound(s: SoundAsset): string {
  return `"${s.name}" (${s.duration.toFixed(1)} s)`;
}

export interface PieceTask {
  /** Short id used in the request and the reply ("p1"). */
  id: string;
  request: PieceRequest;
}

export interface PiecesPromptInput {
  project: Project;
  plans: TargetPlan[];
  /** Pieces to write. */
  tasks: PieceTask[];
  /** Pieces already written that the reply may rewrite ("e1"...). */
  revisable?: PieceTask[];
  /** Pieces that are already written, by key (their code is shown). */
  written: ReadonlyMap<string, CompiledPiece>;
  /** "Fix": problems from the last run. */
  problems?: string[];
  /** The brief the written pieces were made for, when it changed since. */
  briefBefore?: string;
}

function describeTarget(t: Target, plan: TargetPlan, input: PiecesPromptInput, ids: ReadonlyMap<string, string>, marks: ReadonlyMap<string, string>): string {
  const lines: string[] = [];
  lines.push(t.kind === 'stage' ? `## Stage (class ${plan.className})` : `## Sprite "${t.name}" (class ${plan.className})`);
  if (t.description.trim()) lines.push(`About it: ${t.description.trim()}`);
  if (t.kind === 'sprite') {
    const s = t as SpriteTarget;
    if (s.variables?.length) lines.push(`Variables for this sprite only: ${s.variables.map((v) => `"${v}"`).join(', ')}`);
    const pos = `x=${s.x}, y=${s.y}, direction ${s.direction}°, rotation style "${s.rotationStyle}"`;
    lines.push(`Starts at ${pos}, size ${s.size}%, ${s.visible ? 'visible' : 'hidden'}`);
  }
  const label = t.kind === 'stage' ? 'Backdrops' : 'Costumes';
  const current = t.costumes[t.currentCostume]?.name;
  lines.push(`${label}: ${t.costumes.length ? t.costumes.map((c) => describeCostume(c)).join(', ') : '(none)'}${current ? `; current: "${current}"` : ''}`);
  lines.push(`Sounds: ${t.sounds.length ? t.sounds.map(describeSound).join(', ') : '(none)'}`);
  const { text } = serializeBlocks(t.blocks, {
    mark: (b) => {
      const key = b.id ? plan.markers.get(b.id) : undefined;
      const id = key ? marks.get(key) : undefined;
      return id ? `⟨${id}⟩` : undefined;
    },
  });
  lines.push(text ? `Program:\n${text.split('\n').map((l) => '  ' + l).join('\n')}` : 'Program: (none)');
  const written = plan.pieces.filter((p) => !ids.has(p.key) && input.written.has(p.key));
  if (written.length) {
    lines.push('Pieces already written for this target\'s words (keep using their names):');
    for (const p of written) lines.push(`### ${marks.get(p.key) ?? 'written'}: ${p.block}\n\`\`\`js\n${input.written.get(p.key)!.code}\n\`\`\``);
  }
  return lines.join('\n');
}

function describeCompiled(compiled: CompiledGame | null): string {
  if (!compiled || (!compiled.assets.length && !compiled.sprites.length)) return '';
  const lines: string[] = [];
  if (compiled.sprites.length) {
    lines.push('## Characters added by earlier compiles (they exist; use them by name). To change one, list it in "sprites" again with its whole new class.');
    for (const s of compiled.sprites) {
      lines.push(`- "${s.name}": ${s.description}`);
      const source = compiled.code.find((c) => c.targetId === s.id)?.source;
      if (source) lines.push(`\`\`\`js\n${source}\n\`\`\``);
    }
  }
  if (compiled.assets.length) {
    lines.push('## Art and sounds made by earlier compiles (they exist)');
    for (const a of compiled.assets) {
      const kind = a.kind === 'sound' ? 'sound' : 'costume';
      lines.push(`- ${kind} "${a.name}" of "${a.targetName}": ${a.request}`);
    }
  }
  return lines.join('\n');
}

/** The compile request's text: the whole project for context, then the pieces to write. */
export function piecesUserPrompt(input: PiecesPromptInput): string {
  const { project, plans, tasks } = input;
  const revisable = input.revisable ?? [];
  const ids = new Map(tasks.map((t) => [t.request.key, t.id]));
  const marks = new Map([...tasks, ...revisable].map((t) => [t.request.key, t.id]));
  const parts: string[] = [];
  parts.push(`Game title: ${project.title || 'Untitled'}`);
  parts.push('World: 2D (480 x 360 stage)');
  if (project.notes.trim()) parts.push(`The author's notes: ${project.notes.trim()}`);
  const brief = plans.flatMap((p) => p.brief);
  if (brief.length) parts.push(['Brief:', ...brief.map((b) => `- ${b}`)].join('\n'));
  const variables = projectVariables(project);
  if (variables.length) parts.push(`Variables for all sprites: ${variables.map((v) => `"${v}"`).join(', ')}`);
  const byId = new Map(plans.map((p) => [p.targetId, p]));
  for (const t of [project.stage, ...project.sprites]) {
    const plan = byId.get(t.id);
    if (plan) parts.push(describeTarget(t, plan, input, ids, marks));
  }
  const compiled = describeCompiled(project.compiled);
  if (compiled) parts.push(compiled);
  if (input.problems?.length) parts.push(['## The last run had these problems (fix them in the pieces below)', ...input.problems.map((p) => `- ${p}`)].join('\n'));
  if (input.briefBefore !== undefined) {
    const before = input.briefBefore.trim() ? input.briefBefore.split('\n').map((l) => `- ${l}`) : ['- (none)'];
    parts.push(['## The brief changed', 'The pieces already written were made for this brief:', ...before, 'Rewrite the ones that should change to fit the brief above.'].join('\n'));
  }
  if (tasks.length) {
    parts.push(
      [
        '## Write these pieces',
        ...tasks.map(({ id, request: r }) => `- ${id}: ${r.kind}${r.kind === 'action' || r.kind === 'timed' ? `, repeats: ${r.inLoop ? 'yes' : 'no'}` : ''}${r.kind === 'game' ? ` (the whole game; imagination: ${r.freedom ?? 'fill in the gaps'})` : ''}, in "${r.targetName}" (${r.script}): ${r.block}`),
      ].join('\n'),
    );
  }
  if (revisable.length) {
    parts.push(
      [
        '## Pieces already written',
        `${revisable.map((t) => t.id).join(', ')} (their code is above). They work as they are: rewrite one only when ${tasks.length ? 'the pieces you write' : 'the new brief'} mean${tasks.length ? '' : 's'} it must change, with its id and its whole new body. Leave the rest out of your reply.`,
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

// -----------------------------------------------------------------------------
// Asset prompts
// -----------------------------------------------------------------------------

/** A costume a sprite already has, for its other costumes to be drawn from. */
export interface ArtReference {
  name: string;
  description: string;
  width: number;
  height: number;
  /** Its drawing (an image model's costume has none: only its description is passed on). */
  svg?: string;
}

/**
 * A sprite's costumes are animation frames, each drawn in its own request: the later ones are given
 * the first one's drawing, to copy and change only where their description says.
 */
function referenceNote(opts: { spriteName: string; width: number; height: number }, ref: ArtReference): string {
  const resized = ref.width !== opts.width || ref.height !== opts.height;
  return `
"${opts.spriteName}" already has the costume "${ref.name}" (${ref.width} x ${ref.height} px: ${ref.description}), drawn below. The game swaps a sprite's costumes in place, as animation frames, so anything that differs between them without a reason makes the character flicker. Draw the new costume by copying that drawing and editing it:
- Keep the same character exactly: the same shapes, proportions, colours, gradients and line weight, at the same size and in the same position on the canvas. Copy the parts that don't change as they are, element for element, with the same numbers.
- Change only what the new costume's description asks for (a leg forward, wings down, eyes closed, a mouth open), by moving or redrawing those parts alone.
- If the new costume is not the same character or thing at all (an explosion, a broken version, another item), draw what is asked instead, in the same style, palette and line weight, at a matching size.${
    resized ? `\n- This canvas is ${opts.width} x ${opts.height} px, not ${ref.width} x ${ref.height}: keep the character the size it is there if it fits, centred the same way, and otherwise scale it down just enough to fit.` : ''
  }
Costume "${ref.name}":
${ref.svg}`;
}

export function svgPrompt(opts: {
  kind: 'costume' | 'backdrop';
  mode: WorldMode;
  width: number;
  height: number;
  description: string;
  spriteName: string;
  gameTitle: string;
  /** The game's art brief, the same for every picture (Amble's own look when left out). */
  style?: ArtBrief;
  /** A costume this sprite already has: the new one is drawn from it. */
  reference?: ArtReference;
}): { system: string; user: string } {
  const style = opts.style ?? artBrief('');
  const heading = style.preset ? `: ${style.preset.label} (${style.preset.words})` : '';
  // The brief comes first and is the same in every request of a game; the rules for this kind of picture follow.
  const system = `You are the artist of a 2D game made in Amble, a game maker for kids: you draw the game's pictures as SVG code, one picture per request. Reply with JSON: { "svg": "<svg ...>...</svg>" }.

# The game's art style${heading}
${style.svg}
Every picture of the game is drawn in its own request, by an artist who cannot see the other pictures, and together they must look like one artist's work. So keep to this brief in every picture: the same colours for the same things, the same outlines, the same shading and the same amount of detail.

# Rules
- The root <svg> must have xmlns="http://www.w3.org/2000/svg", width, height and viewBox="0 0 W H" exactly as requested.
- ${opts.kind === 'backdrop' ? 'Fill the whole canvas (it is a background), in the same style as the sprites. Keep it simple enough that sprites stand out in front of it.' : 'Transparent background: do not draw a background rectangle. The subject should fill most of the canvas with about 4 px margin.'}
- ${opts.kind === 'costume' ? 'Characters and vehicles face right unless told otherwise.' : 'No characters in the foreground.'}
- You may draw with these, unless the art style rules some of them out: path, rect, circle, ellipse, polygon, polyline, line and g; linearGradient, radialGradient, pattern, clipPath, mask and use (pointing at an id in the same picture); and, only where the style calls for them, filters made of feGaussianBlur, feDropShadow, feOffset, feMerge, feFlood, feComposite, feColorMatrix, feTurbulence and feDisplacementMap. Give colours and strokes as attributes (fill="#ffcc00" stroke-width="3"), not with <style> or class.
- No <image>, <foreignObject>, <script>, animation, links, event handlers, external references, CSS files or fonts: they are removed. No text unless asked.
- Keep it under 12 KB.`;
  const lines = [`Game: ${opts.gameTitle}`, `Sprite: ${opts.spriteName}`, `Draw a ${opts.kind} of ${opts.width} x ${opts.height} px${style.words ? `, in the game's art style (${style.name})` : ''}: ${opts.description}`];
  if (style.pixel) {
    const grid = pixelGrid(opts.width, opts.height, opts.kind === 'backdrop');
    lines.push(`Pixel grid: one pixel is ${grid.size} x ${grid.size} units, so this picture is ${grid.columns} x ${grid.rows} pixels; every x, y, width and height is a multiple of ${grid.size}.`);
  }
  if (opts.kind === 'costume' && opts.reference?.svg) lines.push(referenceNote(opts, opts.reference));
  return { system, user: lines.join('\n') };
}

export function imagePrompt(opts: {
  kind: 'costume' | 'backdrop';
  mode: WorldMode;
  description: string;
  gameTitle: string;
  /** The game's art brief (Amble's own look when left out). */
  style?: ArtBrief;
  /** A costume this sprite already has (an image model is only told what it shows). */
  reference?: Pick<ArtReference, 'name' | 'description'>;
}): string {
  const look = opts.style?.image ?? '';
  if (opts.kind === 'backdrop') {
    return look
      ? `A 2D video game background for "${opts.gameTitle}": ${opts.description}. Art style: ${look}. Every picture of the game is in this style. No text, no characters in the foreground.`
      : `A colorful 2D video game background for "${opts.gameTitle}": ${opts.description}. Flat, friendly cartoon style like Scratch, clean shapes, no text, no characters in the foreground.`;
  }
  const same = opts.reference
    ? ` It is another costume of a sprite that already has the costume "${opts.reference.name}", which shows: ${opts.reference.description}. Where this one shows the same character or thing, keep its colours, proportions and details the same, and change only what this costume asks for.`
    : '';
  return `A single game sprite for "${opts.gameTitle}": ${opts.description}. ${
    look ? `Art style: ${look}. Every picture of the game is in this style. Centered` : 'Flat cartoon style like Scratch costumes, bold clean outlines, bright colors, centered'
  }, side view facing right, isolated on a transparent background, no text, no shadow on the ground.${same}`;
}

export function soundPrompt(description: string): { system: string; user: string } {
  const system = `You design short retro game sounds for a tiny synthesizer. Reply with JSON { "segments": [...] } that play one after another.
Each segment: wave ("sine" | "square" | "triangle" | "sawtooth" | "noise"), startFreq and endFreq in Hz (the pitch slides between them; for noise they set brightness: 200 dull .. 8000 bright), duration in seconds, startVolume and endVolume 0..1.
Examples: coin = square 988 Hz 0.07 s then square 1319 Hz 0.22 s fading out. jump = square sliding 220 -> 660 Hz over 0.22 s. explosion = noise 1800 -> 90 over 0.9 s fading out. laser = sawtooth 1600 -> 200 over 0.2 s. Melodies: one short segment per note (use volume 0 segments for rests).
Keep effects under 1.5 s and jingles under 6 s.`;
  return { system, user: `Sound: ${description}` };
}
