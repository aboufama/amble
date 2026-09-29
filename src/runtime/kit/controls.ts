/**
 * One controls object for keyboard, gamepad, the touch overlay and the robot bot:
 * `this.controls.x` (-1..1), `held('jump')`, `pressed('fire')`, `pointer`.
 * Presses are latched from each key's down event until the next frame reads them: on a slow Chromebook
 * frame a quick tap lands down and up inside one frame, and plain polling would never see it.
 */
import Phaser from 'phaser';
import { ACTIONS, type Action } from '../../play/protocol';
import { env } from './env';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  up: ['UP', 'W'],
  down: ['DOWN', 'S'],
  jump: ['SPACE', 'Z', 'UP', 'W'],
  fire: ['X', 'J', 'ENTER'],
  dash: ['SHIFT', 'C', 'K'],
  action: ['E', 'L', 'Q'],
  pause: ['P', 'ESC'],
};

/** Standard gamepad mapping: A jump, X fire, B dash, Y action, Start pause. */
const PAD: Partial<Record<Action, number[]>> = { jump: [0], fire: [2, 7], dash: [1, 5], action: [3], pause: [9] };

export class Controls {
  bind: Record<Action, string[]> = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)) as Record<Action, string[]>;
  /** The touch overlay and the robot bot write here (shared with the runtime). */
  readonly virtual: Partial<Record<Action, boolean>>;
  private ax = 0;
  private ay = 0;
  readonly pointer = { x: 0, y: 0, down: false, justDown: false };
  /** Any key went down this frame (starts the title card). */
  anyKey = false;
  /** R went down this frame (restart after win/lose). */
  tappedRestart = false;
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private latch = new Set<string>();
  private state: Partial<Record<Action, boolean>> = {};
  private prev: Partial<Record<Action, boolean>> = {};
  private anyLatch = false;
  /** A press seen between two polls: a quick tap goes down and up inside one slow frame. */
  private pointerLatch = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly used: Set<Action>,
  ) {
    this.virtual = env().input.actions;
    const kb = scene.input.keyboard;
    if (kb) {
      const names = new Set([...Object.values(DEFAULT_BINDINGS).flat(), 'R']);
      for (const n of names) this.addKey(n);
      const onAny = () => {
        this.anyLatch = true;
      };
      kb.on('keydown', onAny);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => kb.off('keydown', onAny));
    }
    const onPointer = () => {
      this.pointerLatch = true;
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onPointer);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.off(Phaser.Input.Events.POINTER_DOWN, onPointer));
  }

  private addKey(name: string): Phaser.Input.Keyboard.Key | undefined {
    const known = this.keys.get(name);
    if (known) return known;
    const kb = this.scene.input.keyboard;
    if (!kb) return undefined;
    let key: Phaser.Input.Keyboard.Key;
    try {
      key = kb.addKey(name, true);
    } catch {
      return undefined;
    }
    key.on('down', () => this.latch.add(name));
    this.keys.set(name, key);
    return key;
  }

  /** -1..1 left/right (keys, stick, pad). Reading it tells the touch overlay the game moves sideways. */
  get x(): number {
    this.used.add('left');
    this.used.add('right');
    return this.ax;
  }

  /** -1..1 up/down. Reading it asks the touch overlay for a stick. */
  get y(): number {
    this.used.add('up');
    this.used.add('down');
    return this.ay;
  }

  held(a: Action): boolean {
    this.used.add(a);
    return !!this.state[a];
  }

  /** True only on the frame the action started (never lost on slow frames). */
  pressed(a: Action): boolean {
    this.used.add(a);
    return !!this.state[a] && !this.prev[a];
  }

  released(a: Action): boolean {
    this.used.add(a);
    return !this.state[a] && !!this.prev[a];
  }

  get left(): boolean {
    return this.held('left');
  }
  get right(): boolean {
    return this.held('right');
  }
  get up(): boolean {
    return this.held('up');
  }
  get down(): boolean {
    return this.held('down');
  }
  get jump(): boolean {
    return this.held('jump');
  }
  get fire(): boolean {
    return this.held('fire');
  }
  get dash(): boolean {
    return this.held('dash');
  }
  get action(): boolean {
    return this.held('action');
  }

  /** Reads every input once per frame (called by the kit before the game's update). */
  poll(): void {
    this.prev = this.state;
    const st: Partial<Record<Action, boolean>> = {};
    for (const names of Object.values(this.bind)) for (const n of names) this.addKey(n);
    const down = (n: string) => {
      const k = this.keys.get(n);
      return !!k && (k.isDown || this.latch.has(n));
    };
    const taps = env().input.taps;
    for (const a of ACTIONS) {
      st[a] = this.bind[a].some(down) || !!this.virtual[a] || !!taps[a];
      taps[a] = false;
    }
    this.tappedRestart = down('R');
    this.anyKey = this.anyLatch;
    this.anyLatch = false;
    this.latch = new Set();
    let ax = 0;
    let ay = 0;
    const gp = this.scene.input.gamepad;
    const pad = gp && gp.total ? gp.getPad(0) : null;
    if (pad) {
      ax = Math.abs(pad.leftStick.x) > 0.25 ? pad.leftStick.x : 0;
      ay = Math.abs(pad.leftStick.y) > 0.25 ? pad.leftStick.y : 0;
      if (pad.left) ax = -1;
      if (pad.right) ax = 1;
      if (pad.up) ay = -1;
      if (pad.down) ay = 1;
      for (const [a, buttons] of Object.entries(PAD) as Array<[Action, number[]]>) {
        if (buttons.some((i) => pad.buttons[i]?.pressed)) st[a] = true;
      }
    }
    const stick = env().input.stick;
    if (stick) {
      ax = stick.x;
      ay = stick.y;
    }
    if (!ax) ax = (st.right ? 1 : 0) - (st.left ? 1 : 0);
    if (!ay) ay = (st.down ? 1 : 0) - (st.up ? 1 : 0);
    if (ax < -0.3) st.left = true;
    if (ax > 0.3) st.right = true;
    if (ay < -0.5) st.up = true;
    if (ay > 0.5) st.down = true;
    this.ax = Math.max(-1, Math.min(1, ax));
    this.ay = Math.max(-1, Math.min(1, ay));
    this.state = st;
    const p = this.scene.input.activePointer;
    const wasDown = this.pointer.down;
    this.pointer.x = p.worldX;
    this.pointer.y = p.worldY;
    this.pointer.down = p.isDown;
    this.pointer.justDown = (p.isDown && !wasDown) || this.pointerLatch;
    this.pointerLatch = false;
  }
}
