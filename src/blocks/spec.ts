/**
 * The Amble block set. Every input is free text. Blocks give structure (which sprite,
 * when, in what order, loops and branches); the text says what should happen.
 *
 * This file has no Blockly dependency: it drives both the Blockly definitions (editor)
 * and the block-to-text serializer the compiler sends to the AI.
 */

export type CategoryId = 'events' | 'motion' | 'looks' | 'sound' | 'control' | 'sensing' | 'variables' | 'game' | 'world' | 'myblocks';

export interface Category {
  id: CategoryId;
  name: string;
  colour: string;
  secondary: string;
  tertiary: string;
  modes?: Array<'2d' | '3d'>;
}

export const CATEGORIES: Category[] = [
  { id: 'events', name: 'Events', colour: '#FFBF00', secondary: '#E6AC00', tertiary: '#CC9900' },
  { id: 'motion', name: 'Motion', colour: '#4C97FF', secondary: '#4280D7', tertiary: '#3373CC' },
  { id: 'looks', name: 'Looks', colour: '#9966FF', secondary: '#855CD6', tertiary: '#774DCB' },
  { id: 'sound', name: 'Sound', colour: '#CF63CF', secondary: '#C94FC9', tertiary: '#BD42BD' },
  { id: 'control', name: 'Control', colour: '#FFAB19', secondary: '#EC9C13', tertiary: '#CF8B17' },
  { id: 'sensing', name: 'Sensing', colour: '#5CB1D6', secondary: '#47A8D1', tertiary: '#2E8EB8' },
  { id: 'variables', name: 'Variables', colour: '#FF8C1A', secondary: '#FF8000', tertiary: '#DB6E00' },
  { id: 'game', name: 'Game', colour: '#0FBD8C', secondary: '#0DA57A', tertiary: '#0B8E69' },
  { id: 'world', name: '3D World', colour: '#29A3A3', secondary: '#238F8F', tertiary: '#1E7A7A', modes: ['3d'] },
  { id: 'myblocks', name: 'My Blocks', colour: '#FF6680', secondary: '#FF4D6A', tertiary: '#FF3355' },
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

export interface BlockSpec {
  type: string;
  category: CategoryId;
  shape: BlockShape;
  /** Label with {FIELD} placeholders for text inputs and {FLAG} for the green flag icon. */
  label: string;
  /** Second label for if/else blocks. */
  elseLabel?: string;
  /** Default text for each field. */
  fields?: Record<string, string>;
  /** Only offered in these world modes (default: both). */
  modes?: Array<'2d' | '3d'>;
  /** Helps the person using the palette. */
  tooltip: string;
}

export const BLOCKS: BlockSpec[] = [
  // ---- Events
  { type: 'ev_start', category: 'events', shape: 'hat', label: 'when {FLAG} clicked', tooltip: 'Runs when the game starts.' },
  { type: 'ev_key', category: 'events', shape: 'hat', label: 'when {KEY} key pressed', fields: { KEY: 'space' }, tooltip: 'Runs when a key is pressed.' },
  { type: 'ev_click', category: 'events', shape: 'hat', label: 'when this sprite clicked', tooltip: 'Runs when this sprite is clicked or tapped.' },
  { type: 'ev_receive', category: 'events', shape: 'hat', label: 'when I receive {MESSAGE}', fields: { MESSAGE: 'level up' }, tooltip: 'Runs when a message is broadcast.' },
  { type: 'ev_when', category: 'events', shape: 'hat', label: 'when {EVENT}', fields: { EVENT: 'I touch a coin' }, tooltip: 'Runs whenever something you describe happens.' },
  { type: 'ev_broadcast', category: 'events', shape: 'stack', label: 'broadcast {MESSAGE}', fields: { MESSAGE: 'level up' }, tooltip: 'Sends a message to every sprite.' },
  { type: 'ev_broadcast_wait', category: 'events', shape: 'stack', label: 'broadcast {MESSAGE} and wait', fields: { MESSAGE: 'level up' }, tooltip: 'Sends a message and waits until everyone has handled it.' },

  // ---- Motion
  { type: 'mo_move', category: 'motion', shape: 'stack', label: 'move {HOW}', fields: { HOW: '10 steps' }, tooltip: 'Moves the sprite.' },
  { type: 'mo_goto', category: 'motion', shape: 'stack', label: 'go to {WHERE}', fields: { WHERE: 'the center' }, tooltip: 'Jumps to a place.' },
  { type: 'mo_glide', category: 'motion', shape: 'stack', label: 'glide {HOW}', fields: { HOW: 'to the top over 1 second' }, tooltip: 'Moves smoothly over time.' },
  { type: 'mo_turn', category: 'motion', shape: 'stack', label: 'turn {HOW}', fields: { HOW: 'right 15 degrees' }, tooltip: 'Rotates the sprite.' },
  { type: 'mo_point', category: 'motion', shape: 'stack', label: 'point {WHERE}', fields: { WHERE: 'towards the mouse' }, tooltip: 'Faces a direction or thing.' },
  { type: 'mo_control', category: 'motion', shape: 'stack', label: 'control me with {CONTROLS}', fields: { CONTROLS: 'the arrow keys' }, tooltip: 'Lets the player steer this sprite.' },
  { type: 'mo_bounce', category: 'motion', shape: 'stack', label: 'if on edge, bounce', tooltip: 'Bounces off the edges of the screen.' },
  { type: 'mo_physics', category: 'motion', shape: 'stack', label: 'physics: {HOW}', fields: { HOW: 'solid, falls with gravity' }, tooltip: 'Gives the sprite real physics (gravity, collisions, bouncing).' },

  // ---- Looks
  { type: 'lo_say', category: 'looks', shape: 'stack', label: 'say {TEXT}', fields: { TEXT: 'Hello!' }, tooltip: 'Shows a speech bubble.' },
  { type: 'lo_say_for', category: 'looks', shape: 'stack', label: 'say {TEXT} for {TIME}', fields: { TEXT: 'Hello!', TIME: '2 seconds' }, tooltip: 'Shows a speech bubble for a while.' },
  { type: 'lo_costume', category: 'looks', shape: 'stack', label: 'switch costume to {COSTUME}', fields: { COSTUME: 'costume2' }, tooltip: 'Changes how the sprite looks.' },
  { type: 'lo_next_costume', category: 'looks', shape: 'stack', label: 'next costume', tooltip: 'Switches to the next costume.' },
  { type: 'lo_animate', category: 'looks', shape: 'stack', label: 'animate {HOW}', fields: { HOW: 'walking while I move' }, tooltip: 'Plays a costume animation.' },
  { type: 'lo_backdrop', category: 'looks', shape: 'stack', label: 'switch backdrop to {BACKDROP}', fields: { BACKDROP: 'backdrop1' }, tooltip: 'Changes the background.' },
  { type: 'lo_effect', category: 'looks', shape: 'stack', label: 'effect: {HOW}', fields: { HOW: 'flash red for a moment' }, tooltip: 'A visual effect (tint, fade, glow...).' },
  { type: 'lo_size', category: 'looks', shape: 'stack', label: 'set size to {SIZE}', fields: { SIZE: '100%' }, tooltip: 'Makes the sprite bigger or smaller.' },
  { type: 'lo_show', category: 'looks', shape: 'stack', label: 'show', tooltip: 'Makes the sprite visible.' },
  { type: 'lo_hide', category: 'looks', shape: 'stack', label: 'hide', tooltip: 'Makes the sprite invisible.' },
  { type: 'lo_layer', category: 'looks', shape: 'stack', label: 'go to {LAYER} layer', fields: { LAYER: 'front' }, modes: ['2d'], tooltip: 'Draws in front of or behind other sprites.' },

  // ---- Sound
  { type: 'so_play', category: 'sound', shape: 'stack', label: 'start sound {SOUND}', fields: { SOUND: 'pop' }, tooltip: 'Plays a sound and keeps going.' },
  { type: 'so_play_wait', category: 'sound', shape: 'stack', label: 'play sound {SOUND} until done', fields: { SOUND: 'pop' }, tooltip: 'Plays a sound and waits for it to end.' },
  { type: 'so_music', category: 'sound', shape: 'stack', label: 'play music {MUSIC}', fields: { MUSIC: 'a happy loop' }, tooltip: 'Loops background music.' },
  { type: 'so_stop', category: 'sound', shape: 'stack', label: 'stop all sounds', tooltip: 'Silences everything.' },

  // ---- Control
  { type: 'co_wait', category: 'control', shape: 'stack', label: 'wait {TIME}', fields: { TIME: '1 second' }, tooltip: 'Pauses this script.' },
  { type: 'co_repeat', category: 'control', shape: 'c', label: 'repeat {TIMES}', fields: { TIMES: '10 times' }, tooltip: 'Repeats the blocks inside.' },
  { type: 'co_forever', category: 'control', shape: 'c-end', label: 'forever', tooltip: 'Repeats the blocks inside every frame, forever.' },
  { type: 'co_if', category: 'control', shape: 'c', label: 'if {CONDITION} then', fields: { CONDITION: 'I touch the ground' }, tooltip: 'Runs the blocks inside only when something is true.' },
  { type: 'co_if_else', category: 'control', shape: 'e', label: 'if {CONDITION} then', elseLabel: 'else', fields: { CONDITION: 'my health is 0' }, tooltip: 'Chooses between two sets of blocks.' },
  { type: 'co_wait_until', category: 'control', shape: 'stack', label: 'wait until {CONDITION}', fields: { CONDITION: 'the space key is pressed' }, tooltip: 'Pauses until something becomes true.' },
  { type: 'co_repeat_until', category: 'control', shape: 'c', label: 'repeat until {CONDITION}', fields: { CONDITION: 'I reach the edge' }, tooltip: 'Repeats until something becomes true.' },
  { type: 'co_stop', category: 'control', shape: 'cap', label: 'stop {WHAT}', fields: { WHAT: 'the game' }, tooltip: 'Stops the game, this script, or something else.' },
  { type: 'co_clone_start', category: 'control', shape: 'hat', label: 'when I start as a clone', tooltip: 'Runs in each new copy of this sprite.' },
  { type: 'co_create_clone', category: 'control', shape: 'stack', label: 'create clone of {WHAT}', fields: { WHAT: 'myself' }, tooltip: 'Makes a copy of a sprite.' },
  { type: 'co_delete_clone', category: 'control', shape: 'cap', label: 'delete this clone', tooltip: 'Removes this copy.' },

  // ---- Sensing
  { type: 'se_ask', category: 'sensing', shape: 'stack', label: 'ask {QUESTION} and wait', fields: { QUESTION: "What's your name?" }, tooltip: 'Asks the player to type an answer.' },
  { type: 'se_rule_touch', category: 'sensing', shape: 'stack', label: 'when touching {THING} do {ACTION}', fields: { THING: 'an enemy', ACTION: 'lose a life' }, tooltip: 'Reacts whenever this sprite touches something.' },

  // ---- Variables
  { type: 'va_set', category: 'variables', shape: 'stack', label: 'set {VARIABLE} to {VALUE}', fields: { VARIABLE: 'score', VALUE: '0' }, tooltip: 'Stores a value.' },
  { type: 'va_change', category: 'variables', shape: 'stack', label: 'change {VARIABLE} by {AMOUNT}', fields: { VARIABLE: 'score', AMOUNT: '1' }, tooltip: 'Adds to a value.' },
  { type: 'va_show', category: 'variables', shape: 'stack', label: 'show {VARIABLE} on screen', fields: { VARIABLE: 'score' }, tooltip: 'Displays a value while playing.' },

  // ---- Game
  { type: 'ga_do', category: 'game', shape: 'stack', label: 'do {ACTION}', fields: { ACTION: 'anything you can describe' }, tooltip: 'Any action, described in your own words.' },
  { type: 'ga_rule', category: 'game', shape: 'rule', label: 'rule: {RULE}', fields: { RULE: 'the player has 3 lives' }, tooltip: 'A fact or rule that is always true in the game.' },
  { type: 'ga_camera', category: 'game', shape: 'stack', label: 'camera: {HOW}', fields: { HOW: 'follow me' }, tooltip: 'Where the camera looks (scrolling in 2D).' },
  { type: 'ga_effect', category: 'game', shape: 'stack', label: 'particles: {HOW}', fields: { HOW: 'burst of sparkles' }, tooltip: 'Particle effects like sparks, smoke, explosions.' },
  { type: 'ga_win', category: 'game', shape: 'cap', label: 'win the game {HOW}', fields: { HOW: 'and show "You win!"' }, tooltip: 'Ends the game as a win.' },
  { type: 'ga_over', category: 'game', shape: 'cap', label: 'game over {HOW}', fields: { HOW: 'and show the score' }, tooltip: 'Ends the game.' },

  // ---- 3D World
  { type: 'wo_world', category: 'world', shape: 'stack', label: 'world: {HOW}', fields: { HOW: 'sunny grass field with some trees' }, modes: ['3d'], tooltip: 'Sky, ground, lighting and scenery.' },
  { type: 'wo_camera', category: 'world', shape: 'stack', label: 'camera: {HOW}', fields: { HOW: 'third person behind me' }, modes: ['3d'], tooltip: 'Follow, first-person, orbit...' },
  { type: 'wo_build', category: 'world', shape: 'stack', label: 'build {WHAT}', fields: { WHAT: 'a ring of 10 pillars around the center' }, modes: ['3d'], tooltip: 'Creates 3D shapes and scenery from code.' },

  // ---- My Blocks
  { type: 'pr_define', category: 'myblocks', shape: 'hat', label: 'define {NAME}', fields: { NAME: 'jump' }, tooltip: 'Defines your own block.' },
  { type: 'pr_call', category: 'myblocks', shape: 'stack', label: 'run {NAME}', fields: { NAME: 'jump' }, tooltip: 'Runs one of your own blocks.' },
];

export const BLOCK_BY_TYPE = new Map(BLOCKS.map((b) => [b.type, b]));

/** Field names used in a label, in order. */
export function labelFields(label: string): string[] {
  return [...label.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]).filter((f) => f !== 'FLAG');
}

export function blocksForMode(mode: '2d' | '3d'): BlockSpec[] {
  return BLOCKS.filter((b) => !b.modes || b.modes.includes(mode));
}
