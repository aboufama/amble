/**
 * The Amble block set. Most inputs are free text: blocks give structure (which sprite,
 * when, in what order, loops and branches) and the text says what should happen.
 * Inputs whose valid values form a known set (costumes, sounds, keys, messages...)
 * are dropdown menus instead, like in Scratch.
 *
 * This file has no Blockly dependency: it drives both the Blockly definitions (editor)
 * and the block-to-text serializer the compiler sends to the AI.
 */

export type CategoryId = 'motion' | 'looks' | 'sound' | 'events' | 'control' | 'sensing' | 'variables' | 'myblocks' | 'game' | 'world';

export interface Category {
  id: CategoryId;
  name: string;
  colour: string;
  secondary: string;
  tertiary: string;
  modes?: Array<'2d' | '3d'>;
}

/** Scratch's category order; Amble's own categories come last, where Scratch lists extensions. */
export const CATEGORIES: Category[] = [
  { id: 'motion', name: 'Motion', colour: '#4C97FF', secondary: '#4280D7', tertiary: '#3373CC' },
  { id: 'looks', name: 'Looks', colour: '#9966FF', secondary: '#855CD6', tertiary: '#774DCB' },
  { id: 'sound', name: 'Sound', colour: '#CF63CF', secondary: '#C94FC9', tertiary: '#BD42BD' },
  { id: 'events', name: 'Events', colour: '#FFBF00', secondary: '#E6AC00', tertiary: '#CC9900' },
  { id: 'control', name: 'Control', colour: '#FFAB19', secondary: '#EC9C13', tertiary: '#CF8B17' },
  { id: 'sensing', name: 'Sensing', colour: '#5CB1D6', secondary: '#47A8D1', tertiary: '#2E8EB8' },
  { id: 'variables', name: 'Variables', colour: '#FF8C1A', secondary: '#FF8000', tertiary: '#DB6E00' },
  { id: 'myblocks', name: 'My Blocks', colour: '#FF6680', secondary: '#FF4D6A', tertiary: '#FF3355' },
  { id: 'game', name: 'Game', colour: '#0FBD8C', secondary: '#0DA57A', tertiary: '#0B8E69' },
  { id: 'world', name: '3D World', colour: '#29A3A3', secondary: '#238F8F', tertiary: '#1E7A7A', modes: ['3d'] },
];

export type BlockShape =
  /** Starts a script (no block above). */
  | 'hat'
  /** Normal block in a sequence. */
  | 'stack'
  /** Ends a sequence (nothing can go below). */
  | 'cap'
  /** Wraps a sequence (loops, if). */
  | 'c'
  /** C-block that nothing can follow (forever). */
  | 'c-end'
  /** if/else: two wrapped sequences. */
  | 'e'
  /** Standalone statement that doesn't run in order (a rule or fact about the sprite/game). */
  | 'rule';

/**
 * Where a dropdown's options come from.
 * - costume: the edited sprite's costumes (the stage's backdrops when editing the stage)
 * - backdrop: the stage's backdrops
 * - switchBackdrop: the stage's backdrops, then next / previous / random backdrop
 * - sound: the edited sprite's (or stage's) sounds
 * - key: space, arrows, any, a-z, 0-9
 * - message: every broadcast message used in the project, then "New message"
 * - clone: myself and the other sprites
 * - stop, rotation, layer, effect: fixed choices
 * - variable: the project's variables (and the sprite's own), then rename / delete
 * - procedure: the custom blocks defined in the edited sprite
 */
export type MenuKind =
  | 'costume'
  | 'backdrop'
  | 'switchBackdrop'
  | 'sound'
  | 'key'
  | 'message'
  | 'clone'
  | 'stop'
  | 'rotation'
  | 'layer'
  | 'effect'
  | 'variable'
  | 'procedure';

export interface MenuField {
  kind: MenuKind;
  /**
   * 'round': drawn like Scratch's reporter-shaped menus (e.g. "switch costume to (costume2 v)").
   * 'square': drawn like Scratch's field menus (e.g. "when [space v] key pressed").
   */
  shape: 'round' | 'square';
}

export interface BlockSpec {
  type: string;
  category: CategoryId;
  shape: BlockShape;
  /** Label with {FIELD} placeholders for inputs and {FLAG} for the green flag icon. */
  label: string;
  /** Second label for if/else blocks. */
  elseLabel?: string;
  /** Default value of each input (free text or dropdown). */
  fields?: Record<string, string>;
  /** Inputs that are dropdown menus. Every other input is free text. */
  menus?: Record<string, MenuField>;
  /** Only offered in these world modes (default: both). */
  modes?: Array<'2d' | '3d'>;
  /** Only offered when editing these (default: both). Like Scratch, the stage has no motion blocks. */
  targets?: Array<'sprite' | 'stage'>;
  /** Leave a bigger gap after this block in the palette (ends a group, like Scratch). */
  groupEnd?: boolean;
  /** Not offered in the palette (made another way, e.g. "Make a Block"). */
  hidden?: boolean;
  /** Helps the person using the palette. */
  tooltip: string;
}

const round = (kind: MenuKind): MenuField => ({ kind, shape: 'round' });
const square = (kind: MenuKind): MenuField => ({ kind, shape: 'square' });
const SPRITE: Array<'sprite' | 'stage'> = ['sprite'];

export const BLOCKS: BlockSpec[] = [
  // ---- Motion (sprites only, like Scratch)
  { type: 'mo_move', category: 'motion', shape: 'stack', label: 'move {HOW}', fields: { HOW: '10 steps' }, targets: SPRITE, tooltip: 'Moves the sprite.' },
  { type: 'mo_turn', category: 'motion', shape: 'stack', label: 'turn {HOW}', fields: { HOW: 'right 15 degrees' }, targets: SPRITE, groupEnd: true, tooltip: 'Rotates the sprite.' },
  { type: 'mo_goto', category: 'motion', shape: 'stack', label: 'go to {WHERE}', fields: { WHERE: 'the center' }, targets: SPRITE, tooltip: 'Jumps to a place.' },
  { type: 'mo_glide', category: 'motion', shape: 'stack', label: 'glide {HOW}', fields: { HOW: 'to the top over 1 second' }, targets: SPRITE, groupEnd: true, tooltip: 'Moves smoothly over time.' },
  { type: 'mo_point', category: 'motion', shape: 'stack', label: 'point {WHERE}', fields: { WHERE: 'towards the mouse' }, targets: SPRITE, groupEnd: true, tooltip: 'Faces a direction or thing.' },
  { type: 'mo_control', category: 'motion', shape: 'stack', label: 'control me with {CONTROLS}', fields: { CONTROLS: 'the arrow keys' }, targets: SPRITE, tooltip: 'Lets the player steer this sprite.' },
  { type: 'mo_physics', category: 'motion', shape: 'stack', label: 'physics: {HOW}', fields: { HOW: 'solid, falls with gravity' }, targets: SPRITE, groupEnd: true, tooltip: 'Gives the sprite real physics (gravity, collisions, bouncing).' },
  { type: 'mo_bounce', category: 'motion', shape: 'stack', label: 'if on edge, bounce', targets: SPRITE, groupEnd: true, tooltip: 'Bounces off the edges of the screen.' },
  { type: 'mo_rotation', category: 'motion', shape: 'stack', label: 'set rotation style {STYLE}', fields: { STYLE: 'left-right' }, menus: { STYLE: square('rotation') }, targets: SPRITE, modes: ['2d'], tooltip: 'How the sprite turns: flips left and right, all around, or not at all.' },

  // ---- Looks
  { type: 'lo_say_for', category: 'looks', shape: 'stack', label: 'say {TEXT} for {TIME}', fields: { TEXT: 'Hello!', TIME: '2 seconds' }, targets: SPRITE, tooltip: 'Shows a speech bubble for a while.' },
  { type: 'lo_say', category: 'looks', shape: 'stack', label: 'say {TEXT}', fields: { TEXT: 'Hello!' }, targets: SPRITE, groupEnd: true, tooltip: 'Shows a speech bubble.' },
  { type: 'lo_costume', category: 'looks', shape: 'stack', label: 'switch costume to {COSTUME}', fields: { COSTUME: 'costume2' }, menus: { COSTUME: round('costume') }, targets: SPRITE, tooltip: 'Changes how the sprite looks.' },
  { type: 'lo_next_costume', category: 'looks', shape: 'stack', label: 'next costume', targets: SPRITE, tooltip: 'Switches to the next costume.' },
  { type: 'lo_animate', category: 'looks', shape: 'stack', label: 'animate {HOW}', fields: { HOW: 'walking while I move' }, targets: SPRITE, tooltip: 'Plays a costume animation.' },
  { type: 'lo_backdrop', category: 'looks', shape: 'stack', label: 'switch backdrop to {BACKDROP}', fields: { BACKDROP: 'backdrop1' }, menus: { BACKDROP: round('switchBackdrop') }, groupEnd: true, tooltip: 'Changes the background.' },
  { type: 'lo_size', category: 'looks', shape: 'stack', label: 'set size to {SIZE}', fields: { SIZE: '100%' }, targets: SPRITE, groupEnd: true, tooltip: 'Makes the sprite bigger or smaller.' },
  { type: 'lo_effect_change', category: 'looks', shape: 'stack', label: 'change {EFFECT} effect by {AMOUNT}', fields: { EFFECT: 'color', AMOUNT: '25' }, menus: { EFFECT: square('effect') }, tooltip: 'Changes a graphic effect (color, ghost, brightness...).' },
  { type: 'lo_effect_set', category: 'looks', shape: 'stack', label: 'set {EFFECT} effect to {VALUE}', fields: { EFFECT: 'color', VALUE: '0' }, menus: { EFFECT: square('effect') }, tooltip: 'Sets a graphic effect (color, ghost, brightness...).' },
  { type: 'lo_effect_clear', category: 'looks', shape: 'stack', label: 'clear graphic effects', tooltip: 'Removes all graphic effects.' },
  { type: 'lo_effect', category: 'looks', shape: 'stack', label: 'effect: {HOW}', fields: { HOW: 'flash red for a moment' }, groupEnd: true, tooltip: 'Any visual effect, described in your own words (tint, fade, glow...).' },
  { type: 'lo_show', category: 'looks', shape: 'stack', label: 'show', targets: SPRITE, tooltip: 'Makes the sprite visible.' },
  { type: 'lo_hide', category: 'looks', shape: 'stack', label: 'hide', targets: SPRITE, groupEnd: true, tooltip: 'Makes the sprite invisible.' },
  { type: 'lo_layer', category: 'looks', shape: 'stack', label: 'go to {LAYER} layer', fields: { LAYER: 'front' }, menus: { LAYER: square('layer') }, modes: ['2d'], targets: SPRITE, tooltip: 'Draws in front of or behind other sprites.' },

  // ---- Sound
  { type: 'so_play_wait', category: 'sound', shape: 'stack', label: 'play sound {SOUND} until done', fields: { SOUND: 'pop' }, menus: { SOUND: round('sound') }, tooltip: 'Plays a sound and waits for it to end.' },
  { type: 'so_play', category: 'sound', shape: 'stack', label: 'start sound {SOUND}', fields: { SOUND: 'pop' }, menus: { SOUND: round('sound') }, tooltip: 'Plays a sound and keeps going.' },
  { type: 'so_stop', category: 'sound', shape: 'stack', label: 'stop all sounds', groupEnd: true, tooltip: 'Silences everything.' },
  { type: 'so_music', category: 'sound', shape: 'stack', label: 'play music {MUSIC}', fields: { MUSIC: 'a happy loop' }, tooltip: 'Loops background music.' },

  // ---- Events
  { type: 'ev_start', category: 'events', shape: 'hat', label: 'when {FLAG} clicked', tooltip: 'Runs when the game starts.' },
  { type: 'ev_key', category: 'events', shape: 'hat', label: 'when {KEY} key pressed', fields: { KEY: 'space' }, menus: { KEY: square('key') }, tooltip: 'Runs when a key is pressed.' },
  { type: 'ev_click', category: 'events', shape: 'hat', label: 'when this sprite clicked', targets: SPRITE, tooltip: 'Runs when this sprite is clicked or tapped.' },
  { type: 'ev_stage_click', category: 'events', shape: 'hat', label: 'when stage clicked', targets: ['stage'], tooltip: 'Runs when the background is clicked or tapped.' },
  { type: 'ev_backdrop', category: 'events', shape: 'hat', label: 'when backdrop switches to {BACKDROP}', fields: { BACKDROP: 'backdrop1' }, menus: { BACKDROP: square('backdrop') }, groupEnd: true, tooltip: 'Runs when the stage switches to this backdrop.' },
  { type: 'ev_when', category: 'events', shape: 'hat', label: 'when {EVENT}', fields: { EVENT: 'I touch a coin' }, groupEnd: true, tooltip: 'Runs whenever something you describe happens.' },
  { type: 'ev_receive', category: 'events', shape: 'hat', label: 'when I receive {MESSAGE}', fields: { MESSAGE: 'message1' }, menus: { MESSAGE: square('message') }, tooltip: 'Runs when a message is broadcast.' },
  { type: 'ev_broadcast', category: 'events', shape: 'stack', label: 'broadcast {MESSAGE}', fields: { MESSAGE: 'message1' }, menus: { MESSAGE: round('message') }, tooltip: 'Sends a message to every sprite.' },
  { type: 'ev_broadcast_wait', category: 'events', shape: 'stack', label: 'broadcast {MESSAGE} and wait', fields: { MESSAGE: 'message1' }, menus: { MESSAGE: round('message') }, tooltip: 'Sends a message and waits until everyone has handled it.' },

  // ---- Control
  { type: 'co_wait', category: 'control', shape: 'stack', label: 'wait {TIME}', fields: { TIME: '1 second' }, groupEnd: true, tooltip: 'Pauses this script.' },
  { type: 'co_repeat', category: 'control', shape: 'c', label: 'repeat {TIMES}', fields: { TIMES: '10 times' }, tooltip: 'Repeats the blocks inside.' },
  { type: 'co_forever', category: 'control', shape: 'c-end', label: 'forever', groupEnd: true, tooltip: 'Repeats the blocks inside every frame, forever.' },
  { type: 'co_if', category: 'control', shape: 'c', label: 'if {CONDITION} then', fields: { CONDITION: 'I touch the ground' }, tooltip: 'Runs the blocks inside only when something is true.' },
  { type: 'co_if_else', category: 'control', shape: 'e', label: 'if {CONDITION} then', elseLabel: 'else', fields: { CONDITION: 'my health is 0' }, tooltip: 'Chooses between two sets of blocks.' },
  { type: 'co_wait_until', category: 'control', shape: 'stack', label: 'wait until {CONDITION}', fields: { CONDITION: 'the space key is pressed' }, tooltip: 'Pauses until something becomes true.' },
  { type: 'co_repeat_until', category: 'control', shape: 'c', label: 'repeat until {CONDITION}', fields: { CONDITION: 'I reach the edge' }, groupEnd: true, tooltip: 'Repeats until something becomes true.' },
  { type: 'co_stop', category: 'control', shape: 'cap', label: 'stop {WHAT}', fields: { WHAT: 'all' }, menus: { WHAT: square('stop') }, groupEnd: true, tooltip: 'Stops the game, this script, or the other scripts.' },
  { type: 'co_clone_start', category: 'control', shape: 'hat', label: 'when I start as a clone', targets: SPRITE, tooltip: 'Runs in each new copy of this sprite.' },
  { type: 'co_create_clone', category: 'control', shape: 'stack', label: 'create clone of {WHAT}', fields: { WHAT: 'myself' }, menus: { WHAT: round('clone') }, tooltip: 'Makes a copy of a sprite.' },
  { type: 'co_delete_clone', category: 'control', shape: 'cap', label: 'delete this clone', targets: SPRITE, tooltip: 'Removes this copy.' },

  // ---- Sensing
  { type: 'se_ask', category: 'sensing', shape: 'stack', label: 'ask {QUESTION} and wait', fields: { QUESTION: "What's your name?" }, groupEnd: true, tooltip: 'Asks the player to type an answer.' },
  { type: 'se_rule_touch', category: 'sensing', shape: 'stack', label: 'when touching {THING} do {ACTION}', fields: { THING: 'lava', ACTION: 'lose a life' }, targets: SPRITE, tooltip: 'Reacts whenever this sprite touches something.' },

  // ---- Variables (shown under "Make a Variable" once a variable exists)
  { type: 'va_set', category: 'variables', shape: 'stack', label: 'set {VARIABLE} to {VALUE}', fields: { VARIABLE: 'my variable', VALUE: '0' }, menus: { VARIABLE: square('variable') }, tooltip: 'Stores a value.' },
  { type: 'va_change', category: 'variables', shape: 'stack', label: 'change {VARIABLE} by {AMOUNT}', fields: { VARIABLE: 'my variable', AMOUNT: '1' }, menus: { VARIABLE: square('variable') }, tooltip: 'Adds to a value.' },
  { type: 'va_show', category: 'variables', shape: 'stack', label: 'show {VARIABLE} on screen', fields: { VARIABLE: 'my variable' }, menus: { VARIABLE: square('variable') }, tooltip: 'Displays a value while playing.' },

  // ---- My Blocks ("Make a Block" places a define block; run blocks appear once one exists)
  { type: 'pr_define', category: 'myblocks', shape: 'hat', label: 'define {NAME}', fields: { NAME: 'jump' }, hidden: true, tooltip: 'Defines your own block.' },
  { type: 'pr_call', category: 'myblocks', shape: 'stack', label: 'run {NAME}', fields: { NAME: 'jump' }, menus: { NAME: square('procedure') }, tooltip: 'Runs one of your own blocks.' },

  // ---- Game
  { type: 'ga_do', category: 'game', shape: 'stack', label: 'do {ACTION}', fields: { ACTION: 'anything you can describe' }, tooltip: 'Any action, described in your own words.' },
  { type: 'ga_rule', category: 'game', shape: 'rule', label: 'rule: {RULE}', fields: { RULE: 'the player has 3 lives' }, groupEnd: true, tooltip: 'A fact or rule that is always true in the game.' },
  { type: 'ga_camera', category: 'game', shape: 'stack', label: 'camera: {HOW}', fields: { HOW: 'follow me' }, tooltip: 'Where the camera looks (scrolling in 2D).' },
  { type: 'ga_effect', category: 'game', shape: 'stack', label: 'particles: {HOW}', fields: { HOW: 'burst of sparkles' }, groupEnd: true, tooltip: 'Particle effects like sparks, smoke, explosions.' },
  { type: 'ga_win', category: 'game', shape: 'cap', label: 'win the game {HOW}', fields: { HOW: 'and show "You win!"' }, tooltip: 'Ends the game as a win.' },
  { type: 'ga_over', category: 'game', shape: 'cap', label: 'game over {HOW}', fields: { HOW: 'and show the score' }, tooltip: 'Ends the game.' },

  // ---- 3D World
  { type: 'wo_world', category: 'world', shape: 'stack', label: 'world: {HOW}', fields: { HOW: 'sunny grass field with some trees' }, modes: ['3d'], tooltip: 'Sky, ground, lighting and scenery.' },
  { type: 'wo_camera', category: 'world', shape: 'stack', label: 'camera: {HOW}', fields: { HOW: 'third person behind me' }, modes: ['3d'], tooltip: 'Follow, first-person, orbit...' },
  { type: 'wo_build', category: 'world', shape: 'stack', label: 'build {WHAT}', fields: { WHAT: 'a ring of 10 pillars around the center' }, modes: ['3d'], tooltip: 'Creates 3D shapes and scenery from code.' },
];

export const BLOCK_BY_TYPE = new Map(BLOCKS.map((b) => [b.type, b]));

/** Field names used in a label, in order. */
export function labelFields(label: string): string[] {
  return [...label.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]).filter((f) => f !== 'FLAG');
}

/** The dropdown menu of a block's input, if it has one. */
export function menuOf(type: string, field: string): MenuField | undefined {
  return BLOCK_BY_TYPE.get(type)?.menus?.[field];
}

export function blocksForMode(mode: '2d' | '3d'): BlockSpec[] {
  return BLOCKS.filter((b) => !b.modes || b.modes.includes(mode));
}

/** Blocks offered when editing a sprite or the stage in a world mode. */
export function blocksFor(mode: '2d' | '3d', target: 'sprite' | 'stage'): BlockSpec[] {
  return blocksForMode(mode).filter((b) => !b.targets || b.targets.includes(target));
}
