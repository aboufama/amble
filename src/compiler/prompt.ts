import { serializeBlocks } from './serialize';
import { globalVariables } from '../blocks/menus';
import type { CompiledGame, CostumeAsset, Project, SoundAsset, SpriteTarget, Target, WorldMode } from '../project/types';

// -----------------------------------------------------------------------------
// System prompt
// -----------------------------------------------------------------------------

const INTRO = `You are the compiler inside Amble, a Scratch-style game maker. The author builds programs from Scratch-like blocks, but every block input is plain English instead of numbers or variables. You turn the whole block program into a complete, working game for the Amble engine (built on Babylon.js with Havok physics), and list any art, models or sounds the game needs that the author didn't make.

# How to read the program
- The project has a Stage and sprites. Each has its own scripts, costumes and sounds.
- A script starts with a "when ..." block; the blocks under it run in order; indented blocks are inside a loop or branch. Text in [brackets] is what the author typed into a block.
- A value marked with ▾, like [costume2 ▾], was picked from a dropdown menu. It is an exact name: a costume, backdrop, sound, sprite, message, variable or custom block listed in the project, a key, or one of the block's fixed options. Use it exactly as written (same spelling and case). If such a name isn't listed in the project (an older project may have one), treat it as a request: add the missing asset, or pick the closest match and mention it in warnings.
- Read the text like a thoughtful game designer: choose concrete numbers that feel good (speeds, sizes, timings, spawn rates) and fill in the obvious details a playable game needs (keep the player on screen, show the score if there is one, a clear win/lose moment if implied, sensible difficulty).
- Stay faithful to what the author described. Don't add unrelated features, but make what they described feel finished and fun.
- "Rule:" lines are always-true facts about the game. "Note from the author" lines are extra hints.
- When something is ambiguous, pick the most fun interpretation and mention it in warnings.

Blocks -> engine:
- when green flag clicked -> start()   (clones use onSpawn() instead)
- when [key ▾] key pressed -> onKeyDown(key): "space" -> "space", "up arrow" -> "up", "down arrow" -> "down", "left arrow" -> "left", "right arrow" -> "right", letters and digits as is; "any" -> any key
- when this sprite clicked -> onClick();  when stage clicked -> the stage's onClick()
- when backdrop switches to [name ▾] -> onMessage(name) with name === "backdrop:" + the backdrop name (the engine broadcasts it on every switch)
- when I receive [message ▾] -> onMessage(name, data);  broadcast [message ▾] -> this.broadcast(name);  broadcast and wait -> yield* this.broadcastAndWait(name)
- when [anything else] -> implement with the right mechanism (checks in update, onCollide, onMessage, timers...)
- when I start as a clone -> onSpawn();  create clone of [myself ▾] -> this.clone();  create clone of [Name ▾] -> this.game.spawn("Name", {...});  delete this clone -> this.destroy()
- stop [all ▾] -> end the whole game (this.game.over() with a fitting message, or this.game.pause() if nothing should show);  stop [this script ▾] -> return from this script;  stop [other scripts in sprite ▾] -> stop this sprite's other running scripts and timers, then continue
- switch costume to [name ▾] -> this.costume = "name";  switch backdrop to [name ▾] -> this.game.backdrop = "name";  [next backdrop ▾] -> this.game.nextBackdrop();  [previous backdrop ▾] / [random backdrop ▾] -> set this.game.backdrop by index
- start sound [name ▾] -> this.playSound("name");  play sound [name ▾] until done -> yield* this.playSoundUntilDone("name")
- set rotation style [style ▾] -> this.rotationStyle = "style";  go to [front ▾] / [back ▾] layer -> this.bringToFront() / this.sendToBack()
- set / change [effect ▾] effect (Scratch's graphic effects, 0 = none): ghost -> this.opacity = 1 - ghost / 100; color -> shift this.tint's hue (color 0 = no tint); brightness -> this.tint toward white (positive) or black (negative); fisheye, whirl, pixelate, mosaic -> approximate with what the engine can do (size, rotation, tint, opacity) and say so in warnings;  clear graphic effects -> this.opacity = 1, this.tint = null
- define [name] -> a method;  run [name ▾] -> call it (a generator if it waits: yield* this.name())
- forever -> per-tick logic in update(dt), or a \`for (;;) { ...; yield; }\` loop inside a coroutine when it follows other steps
- sequences with wait / glide / say for / repeat -> coroutines: write the hook as a generator, e.g. \`*start() { ...; yield* this.wait(1); ... }\`
- wait until [x] -> yield* this.waitUntil(() => x);  repeat until [x] -> while (!x) { ...; yield; }
- set / change [variable ▾] -> this.game.vars.name for variables for all sprites, a field like this.speed for a sprite's own variable; show [variable ▾] on screen -> this.game.ui.value(label, () => value)
- control me with [..] -> read this.game.input in update(dt);  physics: [..] -> this.addPhysics({...});  camera: [..] -> this.game.camera;  particles: [..] -> this.game.effects.burst({...})
- game over / win the game -> this.game.over(message) / this.game.win(message)`;

const COMMON_API = `# Amble engine API
Each sprite is \`class <ClassName> extends Sprite { ... }\`; the stage is \`class <ClassName> extends Stage { ... }\`. You never construct them: the engine creates one instance per sprite at its editor position/size/costume/visibility, plus any clones. Use the class names given in the project. Prefer start() over constructors (if you write a constructor it must be \`constructor(...a) { super(...a); ... }\`).

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

Motion (details per world below):
  this.moveForward(d), this.turn(degrees), this.pointTowards(target), this.directionTo(target), this.distanceTo(target)
  this.moveTowards(target, step) -> true on arrival;  this.goTo(target);  this.setPosition(x, y, z?)
  target = a Sprite, a sprite name (the nearest one), "mouse", "random", or { x, y, z }
  this.velocity  {x, y, z} in units/second. Works with or without physics (without physics the engine moves the sprite by velocity*dt each tick). Set parts (this.velocity.x = 200) or all (this.velocity = { x: 0, y: 300 }).

Looks:
  this.costume = "name" (read: current costume name); this.costumes (names); this.nextCostume()
  this.animate(["walk1", "walk2"], fps = 8, loop = true) / this.animate() for all costumes; this.stopAnimation()
  this.visible, this.show(), this.hide(); this.size (percent, 100 = natural size); this.opacity (0..1); this.tint = "#ff8080" or null
  this.say(text) (null/"" clears); yield* this.sayFor(text, seconds)
  this.node: the sprite's Babylon TransformNode (parent your own meshes to it); this.mesh: the current costume's mesh

Sensing:
  this.touching("SpriteName" | sprite | [list] | undefined) -> the touching Sprite or null. No physics needed; hidden sprites are ignored.
  this.touching("mouse") -> boolean
  this.game.input.isDown(key), .wasPressed(key) (went down this tick), .wasReleased(key), .axis("horizontal" | "vertical") -> -1..1 from arrow keys and WASD
  this.game.input.mouse -> { x, y, down, clicked (this tick), dx, dy, wheel }
  this.isOnGround() -> standing on something (with physics) or on the ground plane (3D)

Physics (Havok):
  this.addPhysics({ type: "dynamic" | "static" | "kinematic", shape: "box" | "circle" | "capsule", mass, friction, bounce, fixedRotation, gravity, sensor, damping, scale })
    dynamic: moved by physics. static: floors, walls, platforms. kinematic: moved by your code (set position or velocity), pushes dynamic bodies. sensor: detects overlaps only.
    Characters that must not tip over: fixedRotation: true. The collider matches the current costume and size (call addPhysics after setting size).
  this.velocity, this.applyImpulse(x, y, z?), this.applyForce(x, y, z?), this.removePhysics(), this.body (Babylon PhysicsBody)
  this.game.physics.gravity = { y: ... }

Sprites and clones:
  this.clone(props?)  a copy of this sprite (copies position/look/fields, then runs its onSpawn). this.game.spawn("Name", { x, y, ... })  a new copy of any sprite (runs onSpawn). this.destroy()
  this.isClone, this.name, this.game.find("Name"), this.game.findAll("Name"), this.game.count("Name"), this.game.sprites
  Spawner pattern: the original is a hidden template: start() { this.hide(); this.every(1.5, () => this.clone({ x: this.random(-200, 200), visible: true })); } and clones act in onSpawn()/update().

Sound: this.playSound(name, { volume, pitch, loop }) -> { stop() }; yield* this.playSoundUntilDone(name); this.stopSounds(); this.game.music(name) loops music (null stops); this.game.stopAllSounds()

The game (this.game):
  vars: shared object for game-wide state (score, lives, level). Initialize it in the stage's start().
  time (seconds since start), dt, random(min, max) (integers if both are integers), broadcast(name, data), on(name, fn)
  over(message?) / win(message?): show a banner and end the game (nothing after them runs). restart(), pause(), resume()
  ui.text(id, text, { x, y, size, color, align, background, bold })  on-screen text in screen coordinates (x -240..240, y -180..180, 0,0 = center). ui.hide(id), ui.remove(id)
  ui.value(label, () => value, { x, y })  a live value box (score, lives...), stacked top-left by default
  ui.button(id, label, { x, y, size, background }, () => { ... })
  effects.burst({ x, y, z, color, count, speed, size, lifetime, gravity })  particle burst
  backdrop (get/set by name), nextBackdrop(), background = "#rrggbb" (color behind everything)
  scene (the BABYLON.Scene), BABYLON (namespace: MeshBuilder, StandardMaterial, PBRMaterial, Color3, Color4, Vector3, Quaternion, DynamicTexture, ParticleSystem, GlowLayer, TrailMesh, Animation, PhysicsAggregate, PhysicsShapeType...). Vector3 and Color3 are also globals.
  The Stage class also has this.backdrop, this.backdrops, this.nextBackdrop().`;

const API_2D = `# 2D world (this project)
- The screen shows 480 x 360 pixels around the camera. Units are pixels; (0, 0) is the center of the starting view; +x right, +y up.
- this.x, this.y; this.angle in degrees counter-clockwise (0 = facing right, 90 = up); this.rotationStyle = "all around" | "left-right" | "don't rotate"; this.flipX; this.layer (higher draws in front), this.bringToFront(), this.sendToBack()
- this.touching("edge"), this.isOffStage(), this.keepOnStage(), this.bounceOffEdges() use the visible area.
- Physics gravity is 1600 px/s² downward. Good numbers: walk 150-300 px/s, jump velocity 550-750, bullets 400-700 px/s.
- Camera: this.game.camera.follow(sprite, { smooth: 0.85, bounds: { minX, maxX, minY, maxY }, offsetX, offsetY }) for scrolling worlds; camera.x, camera.y, camera.zoom (1 = normal), camera.shake(strength, seconds), camera.view() -> { left, right, top, bottom }. The backdrop stays fixed behind everything.
- Sprites are flat images (their costumes). Extra shapes from code: e.g. BABYLON.MeshBuilder.CreatePlane / CreateDisc with a StandardMaterial (disableLighting = true, emissiveColor = color), at z = 0, mesh.alphaIndex = a high number to draw on top. Prefer costumes (existing or new assets) for anything that looks like a character or object.
- Floors and platforms in a platformer: sprites with addPhysics({ type: "static" }); or invisible walls built from code with BABYLON.PhysicsAggregate.`;

const API_3D = `# 3D world (this project)
- Units are meters; +y is up; the ground is at y = 0. The default camera looks from behind (-z) toward +z; +x is to the right.
- this.x, this.y, this.z; this.heading in degrees around the up axis (0 = facing +z, 90 = facing +x; turn(positive) turns right); this.pitch, this.roll; this.moveForward(d), this.moveSideways(d) (+ = right).
- A sprite's position is at its feet. Image costumes are upright cutouts that always face the camera (100 image pixels = 1 m, so size 100 of a 180 px tall costume is 1.8 m). Model costumes are real 3D models.
- Default world: gradient sky, sun with shadows, ambient light, and a 200 m grass ground with physics. Change it with this.game.world:
  world.sky("#87ceeb" | ["#top", "#horizon"]), world.ground({ size, color, grid } | false), world.fog(color | false, density), world.sunlight({ direction: [x, y, z], intensity, color }), world.ambient(intensity, color?), world.shadows(bool), world.addShadowCaster(mesh), world.groundMesh
- Camera: camera.follow(sprite, { distance: 7, height: 3, smooth: 0.85, lookHeight: 1 }) third person behind the sprite's heading; camera.firstPerson(sprite, { height: 1.6, mouseLook: true }) (click to capture the mouse; the mouse turns the sprite's heading; camera.lookPitch is the up/down look); camera.orbit(target, { distance, height, speed }); camera.position = { x, y, z }; camera.lookAt(x, y, z); camera.fov; camera.shake(strength, seconds); camera.babylon
- Physics gravity is 20 m/s² downward. Good numbers: walk 4-6 m/s, run 8-10, jump velocity 7-9.
- Typical player: start() { this.addPhysics({ shape: "capsule", fixedRotation: true }); this.game.camera.follow(this); } update(dt) { const f = this.game.input.axis("vertical") * 5; this.turn(this.game.input.axis("horizontal") * 150 * dt); const h = this.heading * Math.PI / 180; this.velocity.x = Math.sin(h) * f; this.velocity.z = Math.cos(h) * f; }  (keep velocity.y so gravity works)
- this.game.mouseGround() -> the point on the ground under the mouse (or null).
- Build level geometry and scenery in code with BABYLON.MeshBuilder (CreateBox, CreateCylinder, CreateSphere, CreateGround, CreateTorus...) and StandardMaterial/PBRMaterial colors. Call this.game.world.addShadowCaster(mesh) so they cast shadows, set mesh.receiveShadows = true, and make solid ones collidable with new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, this.game.scene).`;

const OUTPUT_RULES = `# Output
Reply with JSON matching the schema.
- code: one entry per target that has any behavior, including sprites you add. Each source is one class declaration (helper functions or constants may come before it), using the class name given for that target and extending Sprite (or Stage for the stage). No imports/exports, no DOM (document, window), no network, no timers, no async.
- Use costume, backdrop and sound names exactly as listed. You may only use names that exist or that you add to assets.
- Initialize game-wide values in the stage's start(). Reset state at the start of the game so it plays the same every time.
- assets: art, 3D models and sounds the game needs that the author doesn't have. They are generated from your description and shown to the author as compiled assets. Also list every previously compiled asset you want to keep, with reuse = true (same target, kind and name). Reuse them when they still fit, so the game looks the same between builds.
  - kind "costume": 2D sprite image (in 3D: an upright cutout). width/height in pixels (16..400).
  - kind "backdrop": stage background image. 480 x 360 in 2D.
  - kind "model" (3D only): a low-poly model built from primitive shapes. width/height = rough size in meters (a person is ~1.8 tall).
  - kind "sound": a short sound effect or jingle. width = height = 0.
  - In the description, be specific about colors, shapes, style and pose (e.g. "a round red apple with a green leaf, side view").
  - In 3D, build big scenery (floors, walls, platforms, trees) with MeshBuilder in code instead of assets.
- sprites: new sprites the game needs that the author doesn't have (e.g. enemies, bullets, coins). Each needs at least one costume (or model) asset whose target is the new sprite's name, and its own code entry.
- Never rename or remove the author's sprites.`;

export function systemPrompt(mode: WorldMode): string {
  return [INTRO, COMMON_API, mode === '3d' ? API_3D : API_2D, OUTPUT_RULES].join('\n\n');
}

// -----------------------------------------------------------------------------
// Project description (user prompt)
// -----------------------------------------------------------------------------

const RESERVED = new Set(['Sprite', 'Stage', 'BABYLON', 'Vector3', 'Color3', 'Math', 'Object', 'Array', 'String', 'Number', 'Game', 'Date', 'JSON', 'Map', 'Set']);

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

function describeCostume(c: CostumeAsset, mode: WorldMode): string {
  if (c.kind === 'model') return `"${c.name}" (3D model${c.recipe ? '' : ', uploaded .glb'})`;
  const w = Math.round(c.width / (c.resolution || 1));
  const h = Math.round(c.height / (c.resolution || 1));
  return mode === '3d' ? `"${c.name}" (${w}x${h} px image, ${(h / 100).toFixed(2)} m tall as a cutout)` : `"${c.name}" (${w}x${h} px)`;
}

function describeSound(s: SoundAsset): string {
  return `"${s.name}" (${s.duration.toFixed(1)} s)`;
}

function describeTarget(t: Target, className: string, project: Project): string {
  const lines: string[] = [];
  const mode = project.mode;
  if (t.kind === 'stage') {
    lines.push(`## Stage - class name: ${className}`);
  } else {
    lines.push(`## Sprite "${t.name}" - class name: ${className}`);
  }
  if (t.description.trim()) lines.push(`Author's description: ${t.description.trim()}`);
  if (t.kind === 'sprite') {
    const s = t as SpriteTarget;
    if (s.variables?.length) lines.push(`Variables for this sprite only: ${s.variables.map((v) => `"${v}"`).join(', ')}`);
    const pos = mode === '3d' ? `x=${s.x}, y=${s.y}, z=${s.z}, heading ${s.direction}°` : `x=${s.x}, y=${s.y}, angle ${s.direction}°, rotation style "${s.rotationStyle}"`;
    lines.push(`Starts at ${pos}, size ${s.size}%, ${s.visible ? 'visible' : 'hidden'}`);
  }
  const costumes = t.costumes.map((c) => describeCostume(c, mode));
  const current = t.costumes[t.currentCostume]?.name;
  const label = t.kind === 'stage' ? 'Backdrops' : 'Costumes';
  lines.push(`${label} (made by the author): ${costumes.length ? costumes.join(', ') : '(none)'}${current ? `; current: "${current}"` : ''}`);
  lines.push(`Sounds (made by the author): ${t.sounds.length ? t.sounds.map(describeSound).join(', ') : '(none)'}`);
  const { text, scripts } = serializeBlocks(t.blocks);
  lines.push(scripts || text ? 'Scripts:' : 'Scripts: (none)');
  if (text) lines.push(text.split('\n').map((l) => '  ' + l).join('\n'));
  return lines.join('\n');
}

function describePreviousAssets(compiled: CompiledGame | null): string {
  if (!compiled || (!compiled.assets.length && !compiled.sprites.length)) return '';
  const lines = ['## Previously compiled assets (keep them with reuse = true when they still fit)'];
  for (const a of compiled.assets) {
    const kind = a.kind === 'sound' ? 'sound' : a.kind === 'model' ? 'model' : 'costume';
    const size = a.kind === 'image' ? ` ${a.width / (a.resolution || 1)}x${a.height / (a.resolution || 1)}` : '';
    lines.push(`- target "${a.targetName}" ${kind} "${a.name}"${size}: ${a.request}`);
  }
  if (compiled.sprites.length) {
    lines.push('## Sprites added by the previous build (add them again in `sprites` if still needed)');
    for (const s of compiled.sprites) lines.push(`- "${s.name}": ${s.description}`);
  }
  return lines.join('\n');
}

export interface FixContext {
  problems: string[];
  /** Previous code per target name. */
  previous: Array<{ target: string; source: string }>;
}

/** Everything the compiler needs to know about the project, as text. */
export function buildUserPrompt(project: Project, names: Map<string, string>, fix?: FixContext): string {
  const parts: string[] = [];
  parts.push(`Game title: ${project.title || 'Untitled'}`);
  parts.push(project.mode === '3d' ? 'World: 3D' : 'World: 2D (480 x 360 stage)');
  if (project.notes.trim()) parts.push(`Author's description of the game: ${project.notes.trim()}`);
  const variables = globalVariables(project);
  if (variables.length) parts.push(`Variables for all sprites: ${variables.map((v) => `"${v}"`).join(', ')}`);
  parts.push(describeTarget(project.stage, names.get(project.stage.id) ?? 'StageScript', project));
  for (const s of project.sprites) parts.push(describeTarget(s, names.get(s.id) ?? pascal(s.name), project));
  const prev = describePreviousAssets(project.compiled);
  if (prev) parts.push(prev);
  if (fix) {
    parts.push(['## The last build had these problems', ...fix.problems.map((p) => `- ${p}`)].join('\n'));
    parts.push(
      ['## Code from the last build', ...fix.previous.map((p) => `### ${p.target}\n\`\`\`js\n${p.source}\n\`\`\``)].join('\n'),
    );
    parts.push('Fix these problems. Keep everything that already works the same, and reply with the complete result (all code entries and assets).');
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
- ${opts.kind === 'costume' && opts.mode === '2d' ? 'Characters and vehicles face right unless told otherwise.' : ''}${opts.kind === 'costume' && opts.mode === '3d' ? 'This image becomes an upright cardboard cutout in a 3D world: show the subject from the front, standing, with its feet/base on the bottom edge.' : ''}
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
  return `A single game sprite for "${opts.gameTitle}": ${opts.description}. Flat cartoon style like Scratch costumes, bold clean outlines, bright colors, centered, ${opts.mode === '3d' ? 'front view, standing, full body' : 'side view facing right'}, isolated on a transparent background, no text, no shadow on the ground.`;
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
