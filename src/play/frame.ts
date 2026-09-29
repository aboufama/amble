/**
 * One sandboxed game iframe: boots the runtime, then talks over a private MessagePort.
 *
 * Handshake: iframe bootstrap -> 'boot' (window) ; editor -> 'runtime' bytes (window) ; runtime -> 'hello'
 * (window) ; editor -> 'port' (window, transfers a MessagePort) ; then everything uses the port. A second
 * `load` event on the iframe means the game navigated its document (location.href = ...): the frame reports
 * it and must be rebuilt (the editor's `frame-src 'self'` CSP already keeps it from reaching any server).
 */
import { playerSrcdoc } from './bootstrap';
import { PLAYER_LIMITS, RateLimiter } from './limits';
import { PLAYER_CHANNEL, PROTOCOL_VERSION, parseFromPlayer, transferablesOf, type FromPlayer, type FromPlayerType, type ToPlayer } from './protocol';
import { loadRuntime } from './runtimeBytes';

export interface FrameEvents {
  message(msg: FromPlayer): void;
  /** The runtime is up and listening (the frame is warm). */
  ready(): void;
  /** The game navigated its document; this frame is dead. */
  navigated(): void;
  /** The runtime could not be loaded or speaks another protocol version. */
  failed(message: string): void;
}

export interface FrameOptions {
  runtimeUrl: string;
  title?: string;
  /** Hidden frames (spares, robot tests) are kept off-screen and out of the accessibility tree. */
  hidden?: boolean;
}

let nextId = 1;

export class PlayerFrame {
  readonly id = nextId++;
  readonly iframe: HTMLIFrameElement;
  /** performance.now() of the last message from the runtime (the watchdog's heartbeat). */
  lastMessageAt = 0;
  readonly createdAt = performance.now();
  private port: MessagePort | null = null;
  private queue: ToPlayer[] = [];
  private loads = 0;
  private dead = false;
  private readonly limiter = new RateLimiter<FromPlayerType>(PLAYER_LIMITS);

  private readonly onWindowMessage = (event: MessageEvent): void => {
    if (this.dead || event.source !== this.iframe.contentWindow || this.port) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null || (data as { channel?: unknown }).channel !== PLAYER_CHANNEL) return;
    const msg = parseFromPlayer(data);
    if (msg?.type === 'boot') this.sendRuntime();
    else if (msg?.type === 'hello') this.connect(msg.protocol);
  };

  private readonly onLoad = (): void => {
    this.loads++;
    if (this.loads > 1 && !this.dead) {
      this.dead = true;
      this.events.navigated?.();
    }
  };

  constructor(
    container: HTMLElement,
    private readonly options: FrameOptions,
    private events: Partial<FrameEvents> = {},
  ) {
    const iframe = document.createElement('iframe');
    iframe.className = 'amble-player-frame';
    iframe.title = options.title ?? 'Game';
    // Nothing else: no same-origin, popups, forms, modals or top navigation.
    iframe.setAttribute('sandbox', 'allow-scripts');
    // autoplay: the AudioContext starts running after an editor click (tested); gamepad: controllers work.
    iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#0f0c1e';
    this.iframe = iframe;
    if (options.hidden) this.hide();
    iframe.addEventListener('load', this.onLoad);
    window.addEventListener('message', this.onWindowMessage);
    void loadRuntime(options.runtimeUrl).catch((err: Error) => this.fail(err.message));
    void playerSrcdoc(options.title).then((doc) => {
      if (this.dead) return;
      iframe.srcdoc = doc;
      container.append(iframe);
    });
  }

  get ready(): boolean {
    return this.port !== null && !this.dead;
  }

  get alive(): boolean {
    return !this.dead;
  }

  setEvents(events: Partial<FrameEvents>): void {
    this.events = events;
  }

  /** Off-screen but still laid out at a real size (a 0x0 or display:none frame would not boot Phaser's scale manager). */
  hide(): void {
    const f = this.iframe;
    f.style.visibility = 'hidden';
    f.style.pointerEvents = 'none';
    f.tabIndex = -1;
    f.setAttribute('aria-hidden', 'true');
  }

  show(): void {
    this.iframe.style.visibility = '';
    this.iframe.style.pointerEvents = '';
    this.iframe.removeAttribute('tabindex');
    this.iframe.removeAttribute('aria-hidden');
  }

  send(msg: ToPlayer): void {
    if (this.dead) return;
    if (this.port) this.port.postMessage(msg, transferablesOf(msg));
    else this.queue.push(msg);
  }

  /** Lets the runtime lose its WebGL context, then removes the iframe (its renderer process goes with it). */
  destroy(): void {
    if (this.iframe.isConnected && this.port && !this.dead) {
      this.port.postMessage({ type: 'dispose' } satisfies ToPlayer);
      const iframe = this.iframe;
      setTimeout(() => iframe.remove(), 80);
    } else {
      this.iframe.remove();
    }
    this.dead = true;
    this.queue = [];
    window.removeEventListener('message', this.onWindowMessage);
    this.iframe.removeEventListener('load', this.onLoad);
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
    }
  }

  private fail(message: string): void {
    if (this.dead) return;
    this.events.failed?.(message);
  }

  private sendRuntime(): void {
    void loadRuntime(this.options.runtimeUrl).then(
      (bytes) => {
        const win = this.iframe.contentWindow;
        if (this.dead || !win) return;
        const copy = bytes.slice(0);
        win.postMessage({ channel: PLAYER_CHANNEL, type: 'runtime', scripts: [copy] }, '*', [copy]);
      },
      (err: Error) => this.fail(err.message),
    );
  }

  private connect(protocol: number): void {
    const win = this.iframe.contentWindow;
    if (!win || this.dead) return;
    if (protocol !== PROTOCOL_VERSION) {
      this.fail(`The game engine is version ${protocol}, the editor expects ${PROTOCOL_VERSION}. Reload the page.`);
      return;
    }
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event: MessageEvent) => this.receive(event.data);
    win.postMessage({ channel: PLAYER_CHANNEL, type: 'port' }, '*', [channel.port2]);
    this.lastMessageAt = performance.now();
    const queued = this.queue;
    this.queue = [];
    for (const m of queued) this.send(m);
    this.events.ready?.();
  }

  private receive(data: unknown): void {
    if (this.dead) return;
    const msg = parseFromPlayer(data);
    if (!msg) return;
    const now = performance.now();
    this.lastMessageAt = now;
    if (!this.limiter.allow(msg.type, now)) return;
    this.events.message?.(msg);
  }
}
