/**
 * The Amble block language.
 *
 * Blocks come in two flavors that look the same:
 * - exact blocks (move, jump, touching?, repeat, score...) that Amble compiles directly, and
 * - blocks that take your own words (do [...], rule: [...], a condition or number in words),
 *   which the compiler works out from the description.
 *
 * The categories follow how you direct any capable helper: say what you're making (Brief),
 * name exactly who you mean (Characters), set rules and check the result (Rules), and break
 * big jobs into Skills.
 *
 * This file has no Blockly dependency: it drives the editor (src/blocks/blockly.ts) and the
 * compiler (src/compiler/*).
 */

export type CategoryId =
  | 'brief'
  | 'events'
  | 'characters'
  | 'motion'
  | 'game'
  | 'looks'
  | 'sound'
  | 'control'
  | 'logic'
  | 'variables'
  | 'myblocks'
  | 'rules';

export interface Category {
  id: CategoryId;
  name: string;
  colour: string;
  secondary: string;
  tertiary: string;
  modes?: Array<'2d' | '3d'>;
}

export const CATEGORIES: Category[] = [
  { id: 'brief', name: 'Brief', colour: '#5C6BC0', secondary: '#5160B0', tertiary: '#3F4E9E' },
  { id: 'events', name: 'Triggers', colour: '#FFBF00', secondary: '#E6AC00', tertiary: '#CC9900' },
  { id: 'characters', name: 'Characters', colour: '#29A3A3', secondary: '#238F8F', tertiary: '#1E7A7A' },
  { id: 'motion', name: 'Motion', colour: '#4C97FF', secondary: '#4280D7', tertiary: '#3373CC' },
  { id: 'game', name: 'Game', colour: '#0FBD8C', secondary: '#0DA57A', tertiary: '#0B8E69' },
  { id: 'looks', name: 'Looks', colour: '#9966FF', secondary: '#855CD6', tertiary: '#774DCB' },
  { id: 'sound', name: 'Sound', colour: '#CF63CF', secondary: '#C94FC9', tertiary: '#BD42BD' },
  { id: 'control', name: 'Flow', colour: '#FFAB19', secondary: '#EC9C13', tertiary: '#CF8B17' },
  { id: 'logic', name: 'Logic', colour: '#59C059', secondary: '#46B946', tertiary: '#389438' },
  { id: 'variables', name: 'Memory', colour: '#FF8C1A', secondary: '#FF8000', tertiary: '#DB6E00' },
  { id: 'myblocks', name: 'Skills', colour: '#FF6680', secondary: '#FF4D6A', tertiary: '#FF3355' },
  { id: 'rules', name: 'Rules', colour: '#E0584B', secondary: '#CC4B3F', tertiary: '#B33F34' },
];

export type BlockShape =
  /** Starts a script (nothing above it). */
  | 'hat'
  /** A step in a script. */
  | 'stack'
  /** Ends a script (nothing below it). */
  | 'cap'
  /** Wraps steps (loops, if). */
  | 'c'
  /** A wrapping block nothing can follow (forever). */
  | 'c-end'
  /** if/else: two wrapped sets of steps. */
  | 'e'
  /** Stands alone in the code area and holds for the whole game (brief, rules, checks). */
  | 'rule'
  /** Round block that gives a value (a number, words, or a character). Drops into slots. */
  | 'reporter'
  /** Hexagonal block that is true or false. Drops into condition slots. */
  | 'boolean';

/**
 * Where a dropdown's options come from.
 * - costume: the edited sprite's costumes (the stage's backdrops when editing the stage)
 * - switchBackdrop: the stage's backdrops, then next / previous / random backdrop
 * - sound: the edited sprite's (or stage's) sounds
 * - key: space, arrows, any, a-z, 0-9
 * - message: every message used in the project, then "New message"
 * - variable: the project's variables (and the sprite's own), then rename / delete
 * - procedure: the skills defined in the edited sprite
 * - character: the specials an input allows, then every sprite (see CharacterSpecial)
 * - direction, turn, controls, compare, math, prop, layer: fixed choices (see MENU_CHOICES)
 */
export type MenuKind =
  | 'costume'
  | 'switchBackdrop'
  | 'sound'
  | 'key'
  | 'message'
  | 'variable'
  | 'procedure'
  | 'character'
  | 'direction'
  | 'turn'
  | 'controls'
  | 'compare'
  | 'math'
  | 'prop'
  | 'layer';

/** Choices of the fixed menus. The first one is the default. */
export const MENU_CHOICES: Partial<Record<MenuKind, string[]>> = {
  direction: ['right', 'left', 'up', 'down', 'forward', 'backward'],
  turn: ['right', 'left'],
  controls: ['arrow keys', 'left and right arrows', 'WASD', 'A and D', 'the mouse'],
  compare: ['>', '<', '='],
  math: ['+', '-', '×', '÷'],
  prop: ['x', 'y', 'size', 'direction', 'costume number'],
  layer: ['front', 'back'],
};

/**
 * Characters you can point at besides the sprites. `char_ref` / `char_menu` blocks store
 * these words in their NAME field; any other NAME is a sprite's name.
 */
export type CharacterSpecial = 'me' | 'mouse' | 'random' | 'center' | 'edge' | 'anyone';

/** How each special is shown in menus and on character blocks. */
export const CHARACTER_SPECIAL_LABELS: Record<CharacterSpecial, string> = {
  me: 'me',
  mouse: 'the mouse',
  random: 'a random spot',
  center: 'the center',
  edge: 'the edge',
  anyone: 'anyone',
};

export type InputKind =
  /** Your own words. A white field that wraps long text. Nothing drops into it. */
  | 'text'
  /** A fixed name shown on the block (character and variable blocks). Not editable. */
  | 'label'
  /** A number: typed in (a number shadow) or a dropped number/value reporter. */
  | 'number'
  /** Words or a number: typed in (a text shadow) or a dropped number/value reporter. */
  | 'value'
  /** A character: picked from a menu (a `char_menu` shadow) or a dropped character block. */
  | 'character'
  /** A condition: an empty hexagonal slot for a boolean block. */
  | 'condition'
  /** A dropdown field. */
  | 'menu';

export interface InputSpec {
  kind: InputKind;
  /** Default text, number, menu value or character (a sprite name or a CharacterSpecial). */
  default?: string;
  /** For 'menu': where the options come from. */
  menu?: MenuKind;
  /** For 'character': the specials this slot offers (its menu lists them before the sprites). */
  specials?: CharacterSpecial[];
}

/**
 * Blocks that fill value slots until something is dropped in (Blockly shadows):
 * - number slots: `sh_num` with field NUM (a number)
 * - value slots: `sh_txt` with field TEXT (words)
 * - character slots: `char_menu` with field NAME (a sprite name or a CharacterSpecial)
 * Condition slots start empty.
 */
export const SHADOW_TYPES = { number: 'sh_num', value: 'sh_txt', character: 'char_menu' } as const;

/** What a reporter gives: a number, words (or a number), or a character. Boolean blocks give conditions. */
export type OutputKind = 'number' | 'value' | 'character';

export interface BlockSpec {
  type: string;
  category: CategoryId;
  shape: BlockShape;
  /** Label with {INPUT} placeholders and {FLAG} for the green flag icon. */
  label: string;
  /** Second label for if/else blocks. */
  elseLabel?: string;
  /** Every {INPUT} in the label. */
  inputs?: Record<string, InputSpec>;
  /** What a reporter gives. */
  output?: OutputKind;
  /** Only offered in these world modes (default: both). */
  modes?: Array<'2d' | '3d'>;
  /** Only offered when editing these (default: both). */
  targets?: Array<'sprite' | 'stage'>;
  /** Leave a bigger gap after this block in the palette. */
  groupEnd?: boolean;
  /** Not in the static palette (made another way: Make a Skill, variable and character blocks). */
  hidden?: boolean;
  /** Shown on hover. Say what the block does and how to use it, in plain words. */
  tooltip: string;
}

const text = (def: string): InputSpec => ({ kind: 'text', default: def });
const num = (def: number): InputSpec => ({ kind: 'number', default: String(def) });
const value = (def: string): InputSpec => ({ kind: 'value', default: def });
const menu = (kind: MenuKind, def?: string): InputSpec => ({ kind: 'menu', menu: kind, default: def ?? MENU_CHOICES[kind]?.[0] });
const who = (def: string, specials: CharacterSpecial[]): InputSpec => ({ kind: 'character', default: def, specials });
const cond: InputSpec = { kind: 'condition' };

const SPRITE: Array<'sprite' | 'stage'> = ['sprite'];
const STAGE: Array<'sprite' | 'stage'> = ['stage'];
const TWO_D: Array<'2d' | '3d'> = ['2d'];

export const BLOCKS: BlockSpec[] = [
  // ---- Brief: what you're making, for whom, and what "done" means
  { type: 'br_game', category: 'brief', shape: 'rule', label: 'game: {WHAT}', inputs: { WHAT: text('Amble collects stars and dodges spikes') }, tooltip: 'Say what the game is, in a sentence. A clear goal makes everything else fit together.' },
  { type: 'br_audience', category: 'brief', shape: 'rule', label: 'made for: {WHO}', inputs: { WHO: text('kids who are new to games') }, tooltip: 'Who will play it. This decides how hard, fast and wordy the game is.' },
  { type: 'br_style', category: 'brief', shape: 'rule', label: 'art style: {STYLE}', inputs: { STYLE: text('bright cartoon with thick outlines') }, groupEnd: true, tooltip: 'How the game looks. The world is set up in this style, and new art is made to match.' },
  { type: 'br_win', category: 'brief', shape: 'rule', label: 'you win when {COND}', inputs: { COND: cond }, tooltip: 'The goal. The game is won the moment this becomes true.' },
  { type: 'br_lose', category: 'brief', shape: 'rule', label: 'you lose when {COND}', inputs: { COND: cond }, tooltip: 'The game is over the moment this becomes true.' },

  // ---- Triggers: when things happen
  { type: 'ev_start', category: 'events', shape: 'hat', label: 'when {FLAG} clicked', tooltip: 'Runs when the game starts.' },
  { type: 'ev_key', category: 'events', shape: 'hat', label: 'when {KEY} key pressed', inputs: { KEY: menu('key', 'space') }, tooltip: 'Runs once each time the key goes down.' },
  { type: 'ev_hold', category: 'events', shape: 'hat', label: 'while {KEY} key is held', inputs: { KEY: menu('key', 'right arrow') }, tooltip: 'Runs every frame while the key is down. Good for smooth movement.' },
  { type: 'ev_click', category: 'events', shape: 'hat', label: "when I'm clicked", targets: SPRITE, tooltip: 'Runs when this sprite is clicked or tapped.' },
  { type: 'ev_stage_click', category: 'events', shape: 'hat', label: 'when the stage is clicked', targets: STAGE, tooltip: 'Runs when the background is clicked or tapped.' },
  { type: 'ev_touch', category: 'events', shape: 'hat', label: 'when I touch {WHO}', inputs: { WHO: who('anyone', ['anyone', 'edge', 'mouse']) }, targets: SPRITE, tooltip: 'Runs each time this sprite starts touching someone.' },
  { type: 'ev_when', category: 'events', shape: 'hat', label: 'when {COND}', inputs: { COND: cond }, tooltip: 'Runs each time the condition becomes true.' },
  { type: 'ev_every', category: 'events', shape: 'hat', label: 'every {SECONDS} seconds', inputs: { SECONDS: num(2) }, groupEnd: true, tooltip: 'Runs again and again, on a timer.' },
  { type: 'ev_receive', category: 'events', shape: 'hat', label: 'when I hear {MESSAGE}', inputs: { MESSAGE: menu('message', 'message1') }, tooltip: 'Runs when someone tells everyone this message.' },
  { type: 'ev_broadcast', category: 'events', shape: 'stack', label: 'tell everyone {MESSAGE}', inputs: { MESSAGE: menu('message', 'message1') }, tooltip: 'Sends a message to every sprite and the stage, then keeps going.' },
  { type: 'ev_broadcast_wait', category: 'events', shape: 'stack', label: 'tell everyone {MESSAGE} and wait', inputs: { MESSAGE: menu('message', 'message1') }, tooltip: 'Sends a message and waits until everyone who heard it is done.' },

  // ---- Characters: who you mean. The palette adds one character block per sprite, plus the specials.
  { type: 'char_ref', category: 'characters', shape: 'reporter', output: 'character', label: '{NAME}', inputs: { NAME: { kind: 'label', default: 'me' } }, hidden: true, tooltip: 'A character. Drop it into any character slot.' },
  { type: 'char_menu', category: 'characters', shape: 'reporter', output: 'character', label: '{NAME}', inputs: { NAME: { kind: 'menu', menu: 'character', default: 'me' } }, hidden: true, tooltip: 'Pick a character, or drop a character block here.' },
  { type: 'cp_make', category: 'characters', shape: 'stack', label: 'make a copy of {WHO}', inputs: { WHO: who('me', ['me']) }, tooltip: 'Makes a new copy. Copies run "when I\'m created as a copy".' },
  { type: 'co_delete_clone', category: 'characters', shape: 'cap', label: 'remove this copy', targets: SPRITE, tooltip: 'Removes this copy (the original sprite stays).' },
  { type: 'ev_created', category: 'characters', shape: 'hat', label: "when I'm created as a copy", targets: SPRITE, tooltip: 'Runs in each new copy of this sprite.' },
  { type: 'nm_count', category: 'characters', shape: 'reporter', output: 'number', label: 'number of {WHO}', inputs: { WHO: who('me', ['me']) }, tooltip: 'How many of this character there are right now (copies included).' },

  // ---- Motion (sprites only)
  { type: 'mv_move', category: 'motion', shape: 'stack', label: 'move {DIR} {STEPS} steps', inputs: { DIR: menu('direction'), STEPS: num(10) }, targets: SPRITE, tooltip: 'Moves a little. Forward and backward follow the way the sprite faces.' },
  { type: 'mv_turn', category: 'motion', shape: 'stack', label: 'turn {DIR} {DEGREES} degrees', inputs: { DIR: menu('turn'), DEGREES: num(15) }, targets: SPRITE, groupEnd: true, tooltip: 'Rotates the sprite.' },
  { type: 'mv_goto', category: 'motion', shape: 'stack', label: 'go to {WHO}', inputs: { WHO: who('random', ['random', 'mouse', 'center']) }, targets: SPRITE, tooltip: 'Jumps to a character or a place.' },
  { type: 'mv_goto_xy', category: 'motion', shape: 'stack', label: 'go to x: {X} y: {Y}', inputs: { X: num(0), Y: num(0) }, targets: SPRITE, modes: TWO_D, tooltip: 'Jumps to a spot. 0, 0 is the middle; x goes right, y goes up.' },
  { type: 'mv_toward', category: 'motion', shape: 'stack', label: 'move toward {WHO} by {STEPS} steps', inputs: { WHO: who('mouse', ['mouse', 'center']), STEPS: num(5) }, targets: SPRITE, tooltip: 'Takes a step toward a character. Put it in "forever" to chase.' },
  { type: 'mv_point', category: 'motion', shape: 'stack', label: 'point toward {WHO}', inputs: { WHO: who('mouse', ['mouse', 'center']) }, targets: SPRITE, groupEnd: true, tooltip: 'Faces a character.' },
  { type: 'mv_bounce', category: 'motion', shape: 'stack', label: 'bounce off the edges', targets: SPRITE, modes: TWO_D, tooltip: 'Turns around at the edge of the screen.' },
  { type: 'mv_stay', category: 'motion', shape: 'stack', label: 'stay on the screen', targets: SPRITE, modes: TWO_D, tooltip: "Keeps the sprite from leaving the screen." },

  // ---- Game: ready-made game pieces, and blocks for anything you can describe
  { type: 'ga_do', category: 'game', shape: 'stack', label: 'do {ACTION}', inputs: { ACTION: text('spin around once') }, tooltip: 'Anything, in your own words.' },
  { type: 'ga_do_for', category: 'game', shape: 'stack', label: 'do {ACTION} for {SECONDS} seconds', inputs: { ACTION: text('grow big, then back'), SECONDS: num(1) }, groupEnd: true, tooltip: 'Anything that takes time, in your own words. The script waits until it is done.' },
  { type: 'kit_walk', category: 'game', shape: 'stack', label: 'walk with {KEYS} at speed {SPEED}', inputs: { KEYS: menu('controls'), SPEED: num(200) }, targets: SPRITE, tooltip: 'From now on the player steers this sprite. Speed is steps per second.' },
  { type: 'kit_jump', category: 'game', shape: 'stack', label: 'jump with {KEY} strength {POWER}', inputs: { KEY: menu('key', 'space'), POWER: num(600) }, targets: SPRITE, tooltip: 'From now on the key makes this sprite jump when it stands on something. Turns on gravity.' },
  { type: 'kit_gravity', category: 'game', shape: 'stack', label: 'fall with gravity', targets: SPRITE, tooltip: 'Falls and lands on solid things (and on the bottom of the screen).' },
  { type: 'kit_solid', category: 'game', shape: 'stack', label: 'be solid ground', targets: SPRITE, tooltip: 'Others can stand on this sprite, like a floor or a platform.' },
  { type: 'mo_physics', category: 'game', shape: 'stack', label: 'physics: {HOW}', inputs: { HOW: text('bouncy ball that rolls around') }, targets: SPRITE, groupEnd: true, tooltip: 'Any physics, in your own words.' },
  { type: 'kit_follow', category: 'game', shape: 'stack', label: 'camera follows me', targets: SPRITE, tooltip: 'The view scrolls to keep this sprite in sight.' },
  { type: 'ga_camera', category: 'game', shape: 'stack', label: 'camera: {HOW}', inputs: { HOW: text('zoom in slowly') }, tooltip: 'Anything about the view, in your own words.' },
  { type: 'kit_shake', category: 'game', shape: 'stack', label: 'shake the screen', groupEnd: true, tooltip: 'A short screen shake, for hits and explosions.' },
  { type: 'ga_effect', category: 'game', shape: 'stack', label: 'particles: {HOW}', inputs: { HOW: text('burst of sparkles') }, groupEnd: true, tooltip: 'Sparks, smoke, confetti... in your own words.' },
  { type: 'ga_win', category: 'game', shape: 'cap', label: 'win the game {HOW}', inputs: { HOW: text('and show "You win!"') }, tooltip: 'Ends the game as a win.' },
  { type: 'ga_over', category: 'game', shape: 'cap', label: 'game over {HOW}', inputs: { HOW: text('and show the score') }, tooltip: 'Ends the game.' },

  // ---- Looks
  { type: 'lk_say', category: 'looks', shape: 'stack', label: 'say {TEXT}', inputs: { TEXT: value('Hello!') }, targets: SPRITE, tooltip: 'Shows a speech bubble until the next say.' },
  { type: 'lk_say_for', category: 'looks', shape: 'stack', label: 'say {TEXT} for {SECONDS} seconds', inputs: { TEXT: value('Hello!'), SECONDS: num(2) }, targets: SPRITE, groupEnd: true, tooltip: 'Shows a speech bubble for a while. The script waits.' },
  { type: 'lo_costume', category: 'looks', shape: 'stack', label: 'switch costume to {COSTUME}', inputs: { COSTUME: menu('costume', 'costume1') }, tooltip: 'Changes how the sprite looks (the stage: its backdrop).' },
  { type: 'lo_next_costume', category: 'looks', shape: 'stack', label: 'next costume', tooltip: 'Switches to the next costume (the stage: the next backdrop).' },
  { type: 'lk_animate', category: 'looks', shape: 'stack', label: 'animate costumes at {FPS} per second', inputs: { FPS: num(8) }, targets: SPRITE, tooltip: 'Keeps flipping through the costumes.' },
  { type: 'lk_animate_stop', category: 'looks', shape: 'stack', label: 'stop animating', targets: SPRITE, groupEnd: true, tooltip: 'Stops flipping through the costumes.' },
  { type: 'lo_backdrop', category: 'looks', shape: 'stack', label: 'switch backdrop to {BACKDROP}', inputs: { BACKDROP: menu('switchBackdrop', 'backdrop1') }, groupEnd: true, tooltip: 'Changes the background.' },
  { type: 'lk_size', category: 'looks', shape: 'stack', label: 'set size to {SIZE} %', inputs: { SIZE: num(100) }, targets: SPRITE, tooltip: '100 is the normal size.' },
  { type: 'lk_grow', category: 'looks', shape: 'stack', label: 'change size by {SIZE}', inputs: { SIZE: num(10) }, targets: SPRITE, groupEnd: true, tooltip: 'Bigger (or smaller with a minus number).' },
  { type: 'lo_show', category: 'looks', shape: 'stack', label: 'show', targets: SPRITE, tooltip: 'Makes the sprite visible.' },
  { type: 'lo_hide', category: 'looks', shape: 'stack', label: 'hide', targets: SPRITE, tooltip: 'Makes the sprite invisible. Hidden sprites touch nothing.' },
  { type: 'lo_layer', category: 'looks', shape: 'stack', label: 'go to {LAYER} layer', inputs: { LAYER: menu('layer') }, targets: SPRITE, modes: TWO_D, tooltip: 'Draws in front of or behind the other sprites.' },

  // ---- Sound
  { type: 'so_play', category: 'sound', shape: 'stack', label: 'play sound {SOUND}', inputs: { SOUND: menu('sound', 'pop') }, tooltip: 'Plays a sound and keeps going.' },
  { type: 'so_play_wait', category: 'sound', shape: 'stack', label: 'play sound {SOUND} until done', inputs: { SOUND: menu('sound', 'pop') }, tooltip: 'Plays a sound and waits for it to end.' },
  { type: 'sd_music', category: 'sound', shape: 'stack', label: 'play {SOUND} as music', inputs: { SOUND: menu('sound', 'pop') }, tooltip: 'Loops a sound in the background. Only one music plays at a time.' },
  { type: 'so_stop', category: 'sound', shape: 'stack', label: 'stop all sounds', tooltip: 'Silences everything, music too.' },

  // ---- Flow
  { type: 'fl_wait', category: 'control', shape: 'stack', label: 'wait {SECONDS} seconds', inputs: { SECONDS: num(1) }, groupEnd: true, tooltip: 'Pauses this script.' },
  { type: 'fl_repeat', category: 'control', shape: 'c', label: 'repeat {TIMES} times', inputs: { TIMES: num(10) }, tooltip: 'Runs the blocks inside again and again, one round per frame.' },
  { type: 'co_forever', category: 'control', shape: 'c-end', label: 'forever', groupEnd: true, tooltip: 'Runs the blocks inside every frame, forever.' },
  { type: 'fl_if', category: 'control', shape: 'c', label: 'if {COND} then', inputs: { COND: cond }, tooltip: 'Runs the blocks inside only when the condition is true.' },
  { type: 'fl_if_else', category: 'control', shape: 'e', label: 'if {COND} then', elseLabel: 'else', inputs: { COND: cond }, groupEnd: true, tooltip: 'Chooses between two sets of blocks.' },
  { type: 'fl_wait_until', category: 'control', shape: 'stack', label: 'wait until {COND}', inputs: { COND: cond }, tooltip: 'Pauses until the condition is true.' },
  { type: 'fl_repeat_until', category: 'control', shape: 'c', label: 'repeat until {COND}', inputs: { COND: cond }, groupEnd: true, tooltip: 'Repeats until the condition is true.' },
  { type: 'fl_stop', category: 'control', shape: 'cap', label: 'stop this script', tooltip: 'Ends this script. Other scripts keep going.' },

  // ---- Logic: conditions and numbers
  { type: 'cd_touching', category: 'logic', shape: 'boolean', label: 'touching {WHO}?', inputs: { WHO: who('edge', ['anyone', 'edge', 'mouse']) }, targets: SPRITE, tooltip: 'True while this sprite touches the character.' },
  { type: 'cd_key', category: 'logic', shape: 'boolean', label: '{KEY} key pressed?', inputs: { KEY: menu('key', 'space') }, tooltip: 'True while the key is down.' },
  { type: 'cd_mouse', category: 'logic', shape: 'boolean', label: 'mouse down?', tooltip: 'True while the mouse button (or a finger) is down.' },
  { type: 'cd_ground', category: 'logic', shape: 'boolean', label: 'on the ground?', targets: SPRITE, groupEnd: true, tooltip: 'True while this sprite stands on something.' },
  { type: 'cd_compare', category: 'logic', shape: 'boolean', label: '{A} {OP} {B}', inputs: { A: value(''), OP: menu('compare'), B: value('10') }, tooltip: 'Compares two numbers (= also compares words).' },
  { type: 'cd_and', category: 'logic', shape: 'boolean', label: '{A} and {B}', inputs: { A: cond, B: cond }, tooltip: 'True when both are true.' },
  { type: 'cd_or', category: 'logic', shape: 'boolean', label: '{A} or {B}', inputs: { A: cond, B: cond }, tooltip: 'True when either is true.' },
  { type: 'cd_not', category: 'logic', shape: 'boolean', label: 'not {A}', inputs: { A: cond }, tooltip: 'True when the other is false.' },
  { type: 'cd_words', category: 'logic', shape: 'boolean', label: '{TEXT}', inputs: { TEXT: text('I am near the flag') }, groupEnd: true, tooltip: 'Any condition, in your own words.' },
  { type: 'nm_random', category: 'logic', shape: 'reporter', output: 'number', label: 'random {A} to {B}', inputs: { A: num(1), B: num(10) }, tooltip: 'A random whole number (or decimal, if you use decimals).' },
  { type: 'nm_math', category: 'logic', shape: 'reporter', output: 'number', label: '{A} {OP} {B}', inputs: { A: num(0), OP: menu('math'), B: num(0) }, tooltip: 'Adds, subtracts, multiplies or divides.' },
  { type: 'nm_distance', category: 'logic', shape: 'reporter', output: 'number', label: 'distance to {WHO}', inputs: { WHO: who('mouse', ['mouse', 'center']) }, targets: SPRITE, tooltip: 'How far away the character is, in steps.' },
  { type: 'nm_my', category: 'logic', shape: 'reporter', output: 'number', label: 'my {PROP}', inputs: { PROP: menu('prop') }, targets: SPRITE, tooltip: 'This sprite\'s position, size, direction or costume number.' },
  { type: 'nm_timer', category: 'logic', shape: 'reporter', output: 'number', label: 'time', tooltip: 'Seconds since the game started.' },
  { type: 'nm_words', category: 'logic', shape: 'reporter', output: 'value', label: '{TEXT}', inputs: { TEXT: text('a speed that gets faster over time') }, tooltip: 'Any number or words, described in your own words.' },

  // ---- Memory: variables. The palette adds one round block per variable.
  { type: 'mem_var', category: 'variables', shape: 'reporter', output: 'value', label: '{VARIABLE}', inputs: { VARIABLE: { kind: 'label', default: 'my variable' } }, hidden: true, tooltip: 'The value this variable holds.' },
  { type: 'mem_set', category: 'variables', shape: 'stack', label: 'set {VARIABLE} to {VALUE}', inputs: { VARIABLE: menu('variable', 'my variable'), VALUE: value('0') }, tooltip: 'Stores a value.' },
  { type: 'mem_change', category: 'variables', shape: 'stack', label: 'change {VARIABLE} by {AMOUNT}', inputs: { VARIABLE: menu('variable', 'my variable'), AMOUNT: num(1) }, tooltip: 'Adds to a value (or takes away, with a minus number).' },
  { type: 'va_show', category: 'variables', shape: 'stack', label: 'show {VARIABLE} on screen', inputs: { VARIABLE: menu('variable', 'my variable') }, groupEnd: true, tooltip: 'Shows the value while playing.' },
  { type: 'mem_ask', category: 'variables', shape: 'stack', label: 'ask {QUESTION} and wait', inputs: { QUESTION: value("What's your name?") }, tooltip: 'Asks the player to type an answer.' },
  { type: 'nm_answer', category: 'variables', shape: 'reporter', output: 'value', label: 'answer', tooltip: 'What the player typed last.' },

  // ---- Skills ("Make a Skill" places a skill block; use blocks appear once one exists)
  { type: 'pr_define', category: 'myblocks', shape: 'hat', label: 'skill {NAME}', inputs: { NAME: text('jump') }, hidden: true, tooltip: 'A skill: steps with a name. Break big jobs into skills and use them anywhere.' },
  { type: 'pr_call', category: 'myblocks', shape: 'stack', label: 'use skill {NAME}', inputs: { NAME: menu('procedure', 'jump') }, tooltip: 'Runs one of your skills, then keeps going.' },

  // ---- Rules: what must always hold, and checks that it does
  { type: 'ga_rule', category: 'rules', shape: 'rule', label: 'rule: {RULE}', inputs: { RULE: text('the player has 3 lives') }, tooltip: 'A fact about the game, in your own words. It holds for the whole game.' },
  { type: 'ru_always', category: 'rules', shape: 'rule', label: 'always: {RULE}', inputs: { RULE: text('face the way I move') }, targets: SPRITE, tooltip: 'Something this sprite always does, the whole game.' },
  { type: 'ru_never', category: 'rules', shape: 'rule', label: 'never: {RULE}', inputs: { RULE: text('walk through walls') }, targets: SPRITE, groupEnd: true, tooltip: 'Something this sprite must never do. Saying what not to do is as useful as saying what to do.' },
  { type: 'ru_check', category: 'rules', shape: 'rule', label: 'check: {COND}', inputs: { COND: cond }, tooltip: 'Something that should always be true. While you play, Amble tells you if it ever isn\'t.' },
];

export const BLOCK_BY_TYPE = new Map(BLOCKS.map((b) => [b.type, b]));

/** Input names used in a label, in order. */
export function labelInputs(label: string): string[] {
  return [...label.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]).filter((f) => f !== 'FLAG');
}

/** The dropdown menu of a block's input, if it is a dropdown field. */
export function menuOf(type: string, input: string): MenuKind | undefined {
  const spec = BLOCK_BY_TYPE.get(type)?.inputs?.[input];
  return spec?.kind === 'menu' ? spec.menu : undefined;
}

export function blocksForMode(mode: '2d' | '3d'): BlockSpec[] {
  return BLOCKS.filter((b) => !b.modes || b.modes.includes(mode));
}

/** Blocks offered when editing a sprite or the stage in a world mode. */
export function blocksFor(mode: '2d' | '3d', target: 'sprite' | 'stage'): BlockSpec[] {
  return blocksForMode(mode).filter((b) => !b.targets || b.targets.includes(target));
}
