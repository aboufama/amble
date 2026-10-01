import { serializeBlocks } from './serialize';
import { projectVariables, type PieceRequest, type TargetPlan } from './codegen';
import type { CompiledGame, CompiledPiece, CostumeAsset, Project, SoundAsset, SpriteTarget, Target, WorldMode } from '../project/types';

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
  ui.text(id, text, { x, y, size, color, align, background, bold })  on-screen text in screen coordinates (x -240..240, y -180..180, 0,0 = center). ui.hide(id), ui.remove(id)
  ui.value(label, () => value, { x, y })  a live value box (score, lives...), stacked top-left by default
  ui.button(id, label, { x, y, size, background }, () => { ... })
  effects.burst({ x, y, color, count, speed, size, lifetime, gravity })  particle burst
  camera: follow(sprite, { smooth: 0.85, bounds: { minX, maxX, minY, maxY }, offsetX, offsetY }) for scrolling worlds; x, y, zoom (1 = normal); shake(strength, seconds); view() -> { left, right, top, bottom }; phaser (Phaser's camera: flash(ms, r, g, b), fade, postFX). The backdrop stays fixed behind everything.
  backdrop (get/set by name), nextBackdrop(), background = "#rrggbb" (color behind everything)
  The Stage class also has this.backdrop, this.backdrops, this.nextBackdrop().

# Phaser (for anything more elaborate)
this.game.scene is the Phaser.Scene the game runs in, and \`Phaser\` is a global. Use them freely for what the API above doesn't cover:
- Drawing: scene.add.graphics() (fillStyle, fillGradientStyle, fillRect, fillRoundedRect, fillCircle, lineStyle, strokePath...), scene.add.rectangle / ellipse / star / polygon, scene.add.text(x, y, text, style), scene.add.tileSprite (repeating backgrounds; scroll with tilePositionX), scene.add.image(x, y, sprite.image.texture.key) to reuse a costume.
- Particles: scene.add.particles(x, y, "amble-dot", { speed, lifespan, scale, alpha, tint, frequency, quantity, gravityY, blendMode: "ADD", follow: sprite.image... }) for rain, snow, sparkles, trails, fire, smoke. "amble-dot" is a soft white dot; tint it.
- Effects (WebGL): sprite.image.postFX.addGlow(color, strength), addShadow(), addBloom(), addVignette(), addBlur(); camera.phaser.postFX.addVignette(...), addBloom(...), addColorMatrix().grayscale(); camera.phaser.flash(250), camera.phaser.fade(...).
- Tweens: scene.tweens.add({ targets, props or fields, duration (ms), ease: "Sine.easeInOut", yoyo, repeat: -1 }) for visual polish (pulsing, bobbing, color). Keep game logic and timing on Amble's clock (coroutines, this.after, this.every).
- Physics for your own shapes: scene.matter.add.rectangle(wx, wy, w, h, { isStatic: true }) for level geometry, slopes (scene.matter.add.fromVertices), constraints and chains (scene.matter.add.constraint, scene.matter.add.chain).
- Coordinates: Phaser objects use world pixels with y down and (0, 0) at the starting view's top left: worldX = x + 240, worldY = 180 - y for a stage point (x, y). Phaser rotation is in radians, clockwise.
- Depth: sprites draw at their layer (small numbers); setDepth(-10) puts your drawing behind the sprites (the backdrop is further back still) and setDepth(100) in front. setScrollFactor(0) pins something to the screen, setScrollFactor(0.3) makes a slow parallax layer.
- Everything you add is cleaned up when the game stops. No loading files or network: make art from shapes, graphics, particles and the costumes you have (or new assets).`;

const OUTPUT_RULES = `# Characters, art and sound
- Use costume, backdrop and sound names exactly as listed. Only use names that exist or that you add to assets.
- If a piece needs a character that doesn't exist (enemies, coins, bullets...), add it to "sprites" with its whole class (\`class <Name> extends Sprite { ... }\`, same API, hooks like start() and update(dt)) and give it a costume in "assets" with the new sprite's name as the target.
- assets: art and sounds your code uses that don't exist yet. They are made from your description, in the game's art style.
  - costume: an image; width/height in pixels (16..400). backdrop: 480 x 360. sound: width = height = 0.
  - Describe colors, shapes, style and pose specifically (e.g. "a round red apple with a green leaf, side view").
  - Earlier compiled assets are kept; list one again only to replace it.`;

/** The compile request's system prompt. Every game is 2D now; `mode` is left over from 3D projects. */
export function piecesSystemPrompt(mode?: WorldMode): string {
  void mode;
  return [INTRO, COMMON_API, OUTPUT_RULES].join('\n\n');
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
    lines.push('## Characters added by earlier compiles (they exist; use them by name)');
    for (const s of compiled.sprites) lines.push(`- "${s.name}": ${s.description}`);
  }
  if (compiled.assets.length) {
    lines.push('## Art and sounds made by earlier compiles (they exist)');
    for (const a of compiled.assets) {
      const kind = a.kind === 'sound' ? 'sound' : a.kind === 'model' ? 'model' : 'costume';
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
        ...tasks.map(({ id, request: r }) => `- ${id}: ${r.kind}${r.kind === 'action' || r.kind === 'timed' ? `, repeats: ${r.inLoop ? 'yes' : 'no'}` : ''}, in "${r.targetName}" (${r.script}): ${r.block}`),
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

export function svgPrompt(opts: {
  kind: 'costume' | 'backdrop';
  mode: WorldMode;
  width: number;
  height: number;
  description: string;
  spriteName: string;
  gameTitle: string;
  styleHint: string;
}): { system: string; user: string } {
  const system = `You draw game art as SVG, in the friendly flat style of Scratch costumes: bold simple shapes, clean dark outlines (stroke 2-4 px, round joins), bright cheerful colors, a little shading with one or two darker/lighter shapes, no text unless asked. Reply with JSON: { "svg": "<svg ...>...</svg>" }.
Rules:
- The root <svg> must have xmlns="http://www.w3.org/2000/svg", width, height and viewBox="0 0 W H" exactly as requested.
- ${opts.kind === 'backdrop' ? 'Fill the whole canvas (it is a background). Keep it simple enough that sprites stand out in front of it.' : 'Transparent background: do not draw a background rectangle. The subject should fill most of the canvas with about 4 px margin.'}
- ${opts.kind === 'costume' ? 'Characters and vehicles face right unless told otherwise.' : ''}
- Only use basic SVG elements (path, rect, circle, ellipse, polygon, polyline, line, g, linearGradient/radialGradient). No <image>, <foreignObject>, <script>, external references, CSS files or fonts.
- Keep it under 12 KB.`;
  const user = `Game: ${opts.gameTitle}
Sprite: ${opts.spriteName}
Draw a ${opts.kind} of ${opts.width} x ${opts.height} px: ${opts.description}${opts.styleHint ? `\nMatch the style of the author's art: ${opts.styleHint}` : ''}`;
  return { system, user };
}

export function imagePrompt(opts: { kind: 'costume' | 'backdrop'; mode: WorldMode; description: string; gameTitle: string }): string {
  if (opts.kind === 'backdrop') {
    return `A colorful 2D video game background for "${opts.gameTitle}": ${opts.description}. Flat, friendly cartoon style like Scratch, clean shapes, no text, no characters in the foreground.`;
  }
  return `A single game sprite for "${opts.gameTitle}": ${opts.description}. Flat cartoon style like Scratch costumes, bold clean outlines, bright colors, centered, side view facing right, isolated on a transparent background, no text, no shadow on the ground.`;
}

export function modelPrompt(opts: { description: string; width: number; height: number; spriteName: string; gameTitle: string }): {
  system: string;
  user: string;
} {
  const system = `You design low-poly 3D models for a game by combining primitive shapes. Reply with JSON { "parts": [...] }.
Each part: shape ("box" | "sphere" | "cylinder" | "cone" | "torus" | "capsule"), size [width, height, depth] in meters (the part's bounding box), position [x, y, z] of the part's center, rotation [x, y, z] in degrees, color "#rrggbb", roughness 0..1, metalness 0..1, emissive 0..1 (glow), opacity 0..1.
Conventions: the model's origin is its feet/base (y = 0 is the bottom, nothing below it), centered on x = 0 and z = 0; the front faces +z. Use 4-40 parts; overlap parts so there are no gaps; use a cohesive palette; add small details (eyes, trim, windows) that make it readable from a distance.`;
  const user = `Game: ${opts.gameTitle}
Sprite: ${opts.spriteName}
Model: ${opts.description}
Approximate size: ${opts.width || 1} m wide, ${opts.height || 1} m tall.`;
  return { system, user };
}

export function soundPrompt(description: string): { system: string; user: string } {
  const system = `You design short retro game sounds for a tiny synthesizer. Reply with JSON { "segments": [...] } that play one after another.
Each segment: wave ("sine" | "square" | "triangle" | "sawtooth" | "noise"), startFreq and endFreq in Hz (the pitch slides between them; for noise they set brightness: 200 dull .. 8000 bright), duration in seconds, startVolume and endVolume 0..1.
Examples: coin = square 988 Hz 0.07 s then square 1319 Hz 0.22 s fading out. jump = square sliding 220 -> 660 Hz over 0.22 s. explosion = noise 1800 -> 90 over 0.9 s fading out. laser = sawtooth 1600 -> 200 over 0.2 s. Melodies: one short segment per note (use volume 0 segments for rests).
Keep effects under 1.5 s and jingles under 6 s.`;
  return { system, user: `Sound: ${description}` };
}
