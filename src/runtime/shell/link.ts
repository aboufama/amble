/**
 * The runtime's side of the messaging: 'hello' goes up with window.postMessage, the editor answers with a
 * MessagePort, and everything after that uses the port. The native postMessage is captured before game
 * code runs, so a game cannot intercept the port by patching MessagePort.prototype.
 * In a standalone export there is no editor: posts go nowhere and the game data comes from the page.
 */
import { PLAYER_CHANNEL, parseToPlayer, type FromPlayer, type ToPlayer } from '../../play/protocol';

export interface Link {
  readonly standalone: boolean;
  post(msg: FromPlayer): void;
  onMessage(fn: (msg: ToPlayer) => void): void;
  /** Delivers a message as if the editor sent it (standalone exports, tests). */
  inject(msg: ToPlayer): void;
}

export function createLink(standalone: boolean): Link {
  const portPost = MessagePort.prototype.postMessage;
  const parentWindow = window.parent;
  let port: MessagePort | null = null;
  const queue: FromPlayer[] = [];
  const handlers: Array<(msg: ToPlayer) => void> = [];

  const deliver = (data: unknown): void => {
    const msg = parseToPlayer(data);
    if (!msg) return;
    for (const h of handlers) h(msg);
  };

  if (!standalone) {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== parentWindow || port) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null || (data as { channel?: unknown }).channel !== PLAYER_CHANNEL) return;
      if ((data as { type?: unknown }).type !== 'port' || !event.ports[0]) return;
      port = event.ports[0];
      port.onmessage = (e: MessageEvent) => deliver(e.data);
      const pending = queue.splice(0);
      for (const m of pending) portPost.call(port, m);
    });
  }

  return {
    standalone,
    post(msg) {
      if (standalone) return;
      if (msg.type === 'hello' || msg.type === 'boot') {
        parentWindow.postMessage({ channel: PLAYER_CHANNEL, ...msg }, '*');
        return;
      }
      if (port) portPost.call(port, msg);
      else if (queue.length < 500) queue.push(msg);
    },
    onMessage(fn) {
      handlers.push(fn);
    },
    inject(msg) {
      deliver(msg);
    },
  };
}

