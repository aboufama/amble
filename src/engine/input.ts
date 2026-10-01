import { STAGE_HEIGHT, STAGE_WIDTH } from '../player/protocol';

/** Canonical key names: "up", "down", "left", "right", "space", "enter", "shift", "a".."z", "0".."9", ... */
export function normalizeKey(name: string): string {
  const raw = String(name);
  if (raw === ' ') return 'space';
  const k = raw.trim().toLowerCase();
  const aliases: Record<string, string> = {
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    'up arrow': 'up',
    'down arrow': 'down',
    'left arrow': 'left',
    'right arrow': 'right',
    uparrow: 'up',
    downarrow: 'down',
    leftarrow: 'left',
    rightarrow: 'right',
    spacebar: 'space',
    'space bar': 'space',
    return: 'enter',
    esc: 'escape',
    control: 'ctrl',
    ctrl: 'ctrl',
    del: 'delete',
  };
  return aliases[k] ?? k;
}

/** Maps a DOM keyboard event to a canonical key name. */
export function keyFromEvent(key: string, code: string): string {
  if (code?.startsWith('Digit')) return code.slice(5);
  if (code?.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  return normalizeKey(key);
}

export interface MouseState {
  /** Pointer position in world units (2D: stage pixels accounting for the camera; 3D: same as screenX/Y). */
  x: number;
  y: number;
  /** Pointer position on screen in stage coordinates (-240..240, -180..180). */
  screenX: number;
  screenY: number;
  down: boolean;
  /** True during the tick after a click/tap. */
  clicked: boolean;
  /** Pointer movement this tick (useful with pointer lock). */
  dx: number;
  dy: number;
  /** Scroll wheel movement this tick. */
  wheel: number;
}

export interface Click {
  screenX: number;
  screenY: number;
  /** Canvas pixel coordinates (for picking). */
  canvasX: number;
  canvasY: number;
}

/** Keyboard, mouse, touch and pointer lock, sampled once per fixed tick. */
export class Input {
  readonly mouse: MouseState = { x: 0, y: 0, screenX: 0, screenY: 0, down: false, clicked: false, dx: 0, dy: 0, wheel: 0 };
  /** Keys that went down this tick, in order (drives onKeyDown hooks). */
  pressedThisTick: string[] = [];
  releasedThisTick: string[] = [];
  clicksThisTick: Click[] = [];

  private down = new Set<string>();
  private pressedQueue: string[] = [];
  private releasedQueue: string[] = [];
  private clickQueue: Click[] = [];
  private moveX = 0;
  private moveY = 0;
  private wheelAccum = 0;
  private wantPointerLock = false;
  private cleanup: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement | Document, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab'].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.keyDown(keyFromEvent(e.key, e.code));
    });
    on(window, 'keyup', (e) => this.keyUp(keyFromEvent(e.key, e.code)));
    on(window, 'blur', () => this.releaseAll());
    on(canvas, 'pointerdown', (e) => {
      canvas.focus();
      this.updatePointer(e);
      this.mouse.down = true;
      if (this.wantPointerLock && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
      }
      const rect = canvas.getBoundingClientRect();
      this.clickQueue.push({
        screenX: this.mouse.screenX,
        screenY: this.mouse.screenY,
        canvasX: e.clientX - rect.left,
        canvasY: e.clientY - rect.top,
      });
    });
    on(window, 'pointerup', () => {
      this.mouse.down = false;
    });
    on(window, 'pointermove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.moveX += e.movementX;
        this.moveY += e.movementY;
      } else {
        const prevX = this.mouse.screenX;
        const prevY = this.mouse.screenY;
        this.updatePointer(e);
        this.moveX += this.mouse.screenX - prevX;
        this.moveY -= this.mouse.screenY - prevY;
      }
    });
    on(canvas, 'wheel', (e) => {
      e.preventDefault();
      this.wheelAccum += e.deltaY;
    }, { passive: false });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.mouse.screenX = ((e.clientX - rect.left) / rect.width) * STAGE_WIDTH - STAGE_WIDTH / 2;
    this.mouse.screenY = STAGE_HEIGHT / 2 - ((e.clientY - rect.top) / rect.height) * STAGE_HEIGHT;
  }

  keyDown(name: string): void {
    const key = normalizeKey(name);
    if (this.down.has(key)) return;
    this.down.add(key);
    this.pressedQueue.push(key);
  }

  keyUp(name: string): void {
    const key = normalizeKey(name);
    if (!this.down.has(key)) return;
    this.down.delete(key);
    this.releasedQueue.push(key);
  }

  releaseAll(): void {
    for (const key of this.down) this.releasedQueue.push(key);
    this.down.clear();
    this.mouse.down = false;
  }

  /** Called at the start of every fixed tick. */
  beginTick(): void {
    this.pressedThisTick = this.pressedQueue;
    this.releasedThisTick = this.releasedQueue;
    this.clicksThisTick = this.clickQueue;
    this.pressedQueue = [];
    this.releasedQueue = [];
    this.clickQueue = [];
    this.mouse.clicked = this.clicksThisTick.length > 0;
    this.mouse.dx = this.moveX;
    this.mouse.dy = this.moveY;
    this.mouse.wheel = this.wheelAccum;
    this.moveX = 0;
    this.moveY = 0;
    this.wheelAccum = 0;
  }

  // ---- API for game code ----

  /** Is the key held down right now? Key names: "left", "right", "up", "down", "space", "a".."z", "0".."9", "enter", "shift", "any". */
  isDown(key: string): boolean {
    const k = normalizeKey(key);
    if (k === 'any') return this.down.size > 0;
    return this.down.has(k);
  }

  /** Did the key go down during this tick? */
  wasPressed(key: string): boolean {
    const k = normalizeKey(key);
    if (k === 'any') return this.pressedThisTick.length > 0;
    return this.pressedThisTick.includes(k);
  }

  /** Did the key go up during this tick? */
  wasReleased(key: string): boolean {
    const k = normalizeKey(key);
    if (k === 'any') return this.releasedThisTick.length > 0;
    return this.releasedThisTick.includes(k);
  }

  /** -1..1 from arrow keys and WASD. "horizontal": left/right (a/d). "vertical": down/up (s/w). */
  axis(name: 'horizontal' | 'vertical' | string): number {
    const n = String(name).toLowerCase();
    if (n.startsWith('h') || n === 'x') {
      return (this.isDown('right') || this.isDown('d') ? 1 : 0) - (this.isDown('left') || this.isDown('a') ? 1 : 0);
    }
    return (this.isDown('up') || this.isDown('w') ? 1 : 0) - (this.isDown('down') || this.isDown('s') ? 1 : 0);
  }

  /** Captures the mouse on the next click (for first-person mouse look). */
  lockPointer(): void {
    this.wantPointerLock = true;
  }

  unlockPointer(): void {
    this.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
