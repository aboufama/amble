import { CHANNEL, type FromPlayer, type PlayerError, type RunPackage, type ToPlayer } from './protocol';

export interface PlayerHandlers {
  onState?(state: 'idle' | 'running' | 'paused' | 'stopped'): void;
  onLoaded?(): void;
  onError?(error: PlayerError): void;
  onLog?(level: 'log' | 'warn' | 'error', message: string): void;
  onSpriteMoved?(name: string, x: number, y: number): void;
}

const base = (): string => new URL(import.meta.env?.BASE_URL ?? '/', window.location.href).href;

/** URL of the bundled player runtime (Phaser + the Amble engine). */
export function playerScriptUrl(): string {
  return new URL('amble-player.js', base()).href;
}

/**
 * The iframe document. It has an opaque origin (sandbox without allow-same-origin) and a
 * Content-Security-Policy that blocks all network access, so compiled game code can't read
 * editor data (like your API key) or send anything anywhere.
 */
export function playerSrcdoc(): string {
  const origin = window.location.origin;
  const csp = [
    "default-src 'none'",
    `script-src ${origin} 'unsafe-eval' 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'connect-src data: blob:',
    'font-src data:',
    'worker-src blob:',
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Amble player</title></head><body><script src="${playerScriptUrl()}"></script></body></html>`;
}

/** Owns one player iframe and speaks its message protocol. */
export class PlayerHost {
  readonly iframe: HTMLIFrameElement;
  private ready = false;
  private queue: ToPlayer[] = [];
  private readonly onPointerUp = () => {
    if (this.ready) this.post({ type: 'pointerUp' });
  };
  private readonly onMessage = (event: MessageEvent) => {
    if (event.source !== this.iframe.contentWindow) return;
    const msg = event.data as (FromPlayer & { channel?: string }) | null;
    if (!msg || msg.channel !== CHANNEL) return;
    this.handle(msg);
  };

  constructor(
    container: HTMLElement,
    private readonly handlers: PlayerHandlers,
  ) {
    const iframe = document.createElement('iframe');
    iframe.className = 'player-frame';
    iframe.title = 'Game stage';
    iframe.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    iframe.setAttribute('allow', 'autoplay; fullscreen');
    iframe.srcdoc = playerSrcdoc();
    this.iframe = iframe;
    window.addEventListener('message', this.onMessage);
    window.addEventListener('pointerup', this.onPointerUp, true);
    container.append(iframe);
  }

  private handle(msg: FromPlayer): void {
    switch (msg.type) {
      case 'hello': {
        this.ready = true;
        const queued = this.queue;
        this.queue = [];
        queued.forEach((m) => this.post(m));
        break;
      }
      case 'loaded':
        this.handlers.onLoaded?.();
        break;
      case 'status':
        this.handlers.onState?.(msg.state);
        break;
      case 'error': {
        const { type: _type, ...error } = msg;
        void _type;
        this.handlers.onError?.(error);
        break;
      }
      case 'log':
        this.handlers.onLog?.(msg.level, msg.message);
        break;
      case 'spriteMoved':
        this.handlers.onSpriteMoved?.(msg.name, msg.x, msg.y);
        break;
    }
  }

  private post(msg: ToPlayer): void {
    this.iframe.contentWindow?.postMessage({ channel: CHANNEL, ...msg }, '*');
  }

  private send(msg: ToPlayer): void {
    if (!this.ready) {
      if (msg.type === 'load') {
        // Only the newest package matters, but a queued "start" must not be lost.
        const queued = this.queue.find((m): m is Extract<ToPlayer, { type: 'load' }> => m.type === 'load');
        if (queued) {
          this.queue = this.queue.filter((m) => m !== queued);
          msg = { ...msg, start: msg.start || queued.start };
        }
      }
      this.queue.push(msg);
      return;
    }
    this.post(msg);
  }

  load(pkg: RunPackage, start = false): void {
    this.send({ type: 'load', pkg, start });
  }

  greenFlag(): void {
    this.send({ type: 'greenFlag' });
    this.focus();
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  key(phase: 'down' | 'up', key: string, code: string): void {
    if (this.ready) this.post({ type: 'key', phase, key, code });
  }

  releaseKeys(): void {
    if (this.ready) this.post({ type: 'releaseKeys' });
  }

  focus(): void {
    this.iframe.focus();
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    this.iframe.remove();
  }
}
