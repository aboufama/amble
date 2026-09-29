/** What a student reads for each rule: plain words, the line, and what to do. */
import type { RuleId } from './types';

export interface KidContext {
  line: number;
  /** The name involved: an API, a variable, a file. */
  name?: string;
  /** A suggested replacement. */
  suggestion?: string;
  /** The fix was already made. */
  fixed?: boolean;
}

function at(line: number): string {
  return line > 0 ? `Line ${line}: ` : '';
}

export function kidMessage(rule: RuleId, c: KidContext): string {
  const l = at(c.line);
  const name = c.name ? `"${c.name}"` : 'this';
  const done = c.fixed ? ' Amble fixed it.' : '';
  switch (rule) {
    case 'syntax':
      return `${l}the computer can't read this line. Look for a missing bracket, quote or comma.`;
    case 'no-game-class':
      return 'The game needs a class called Game that builds on Amble.Scene.';
    case 'extends-phaser-scene':
      return `${l}the game should build on Amble.Scene so the Amble kit works.${done}`;
    case 'bad-base-class':
      return `${l}the Game class has to build on Amble.Scene.`;
    case 'class-name':
      return `${l}the game's class should be called Game.${done}`;
    case 'duplicate-game-class':
      return `${l}only game.js may have a class called Game.`;
    case 'missing-super':
      return `${l}a constructor has to start with super().${done}`;
    case 'async-lifecycle':
      return `${l}Phaser doesn't wait for ${name}, so part of it runs after the game has started.`;
    case 'unknown-api':
      return `${l}${name} isn't part of the Amble kit.${c.suggestion ? ` Did you mean "${c.suggestion}"?` : ''}${done}`;
    case 'unknown-global':
      return `${l}${name} isn't defined anywhere.${c.suggestion ? ` Did you mean "${c.suggestion}"?` : ''}`;
    case 'no-network-or-eval':
      return `${l}games can't use the internet or run hidden code (${name}).`;
    case 'no-storage-or-parent':
      return `${l}games can't reach outside their own box (${name}).`;
    case 'no-escape':
      return `${l}games can't open pages, send messages or change the page (${name}).`;
    case 'raw-timers':
      return `${l}use this.after or this.every instead of ${name}, so timers pause and slow down with the game.`;
    case 'phaser2-api':
      return `${l}this is old Phaser 2 code, and Amble uses Phaser 3.`;
    case 'removed-api':
      return `${l}this Phaser feature was removed in a newer version.`;
    case 'load-url':
      return `${l}games can't load pictures or sounds from the internet.${c.name ? ` ${name} becomes a drawing for you to make.` : ''}${done}`;
    case 'spawn-arg-order':
      return `${l}put x and y first, then the picture's name${c.suggestion ? `: ${c.suggestion}` : ''}.`;
    case 'shoot-args':
      return `${l}shoot() needs who is shooting first, like the hero, not a number.`;
    case 'restart-every-frame':
      return `${l}this restarts the game every frame. Put it inside an if.`;
    case 'create-in-update':
      return `${l}this makes a new object 60 times a second. Make it once in create(), or behind an if or a timer.`;
    case 'this-in-callback':
      return `${l}function () {} loses track of the game here; an arrow () => {} keeps it.${done}`;
    case 'new-game':
      return `${l}don't start a new Phaser.Game: Amble starts your game for you.`;
    case 'kit-overwrite':
      return `${l}this.${c.name ?? 'name'} belongs to the Amble kit. Pick another name.`;
    case 'arcade-timescale':
      return `${l}this slows things down the wrong way. Use this.timeScale or this.fx.slowmo().`;
    case 'no-physics-body':
      return `${l}${name} has no physics body, so it can't move by itself.${done}`;
    case 'infinite-loop':
      return `${l}this loop never stops, so the game would freeze.`;
    case 'undeclared-art':
      return `These pictures are used but not listed in static art: ${c.name ?? ''}. Amble shows stand-ins until you draw them.`;
    case 'dial-thunk':
      return `${l}the dial ${name} only changes the game live when it's written as () => ...${done}`;
    case 'static-literal':
      return `${l}static ${c.name ?? ''} must hold plain values, so Amble can read it without running the game.`;
    case 'size':
      return `The game is too big${c.name ? ` (${c.name})` : ''}. Try splitting it or making it smaller.`;
    case 'bad-path':
      return `${name} isn't a good file name. Use letters, numbers and dashes, ending in .js.`;
    case 'art-manifest':
      return `${l}the list of pictures (static art) has a problem with ${name}.${done}`;
    case 'dials-manifest':
      return `${l}the dial ${name} has a problem: check its lowest, highest and starting numbers.${done}`;
    case 'unknown-dial':
      return `${l}there is no dial called ${name}.${c.suggestion ? ` Did you mean "${c.suggestion}"?` : ''}${done}`;
    case 'patch-directive-in-code':
      return `${l}a line starts with @@, which isn't JavaScript.`;
    case 'graphics-art':
      return `${l}the code draws a character itself. In Amble you draw every character, so it needs to be a picture in static art.`;
    case 'plan-keys':
      return `${name} was missing from the list of pictures, so Amble added it.`;
    case 'drawn-art-kept':
      return `${name} is one of your drawings, so it has to stay in the game.${done}`;
    case 'renamed-art':
      return `${name} got a new name, so your drawing moved with it.`;
    case 'locked-lines':
      return `${l}your teacher locked these lines, so they can't change.`;
  }
}
