/**
 * Small DOM layers over the game canvas, inside the iframe: the kid-facing "Oops!" panel when the game
 * breaks, and a "Tap for sound" chip while the audio is still locked. DOM (not Phaser) so they work even
 * when the game's own scenes are broken or it is a plain Phaser game.
 */

const CSS = `
.amble-oops{position:absolute;left:12px;right:12px;bottom:12px;z-index:30;display:flex;gap:12px;align-items:flex-start;
  padding:12px 14px;border-radius:14px;background:rgba(23,19,43,.94);border:2px solid #ff5c8a;color:#f5f0e6;
  font:600 15px/1.35 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none}
.amble-oops b{display:block;font-size:17px;color:#ffd6e0;margin-bottom:2px}
.amble-oops .amble-oops-msg{font-weight:500;color:#bdb5d6;word-break:break-word}
.amble-oops .amble-oops-icon{flex:none;width:30px;height:30px;border-radius:50%;background:#ff5c8a;color:#1a0f0a;
  display:grid;place-items:center;font:800 19px/1 system-ui,sans-serif}
.amble-sound{position:absolute;right:10px;top:10px;z-index:29;padding:7px 12px;border-radius:999px;border:0;
  background:rgba(23,19,43,.88);color:#f5f0e6;font:700 14px/1 system-ui,sans-serif;cursor:pointer}
`;

let styled = false;

function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
}

let panel: HTMLDivElement | null = null;

/** Shows (or updates) the panel: "Oops! Something broke on line 12 of game.js." */
export function showErrorPanel(title: string, message: string): void {
  ensureStyle();
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'amble-oops';
    panel.setAttribute('role', 'alert');
    document.body.append(panel);
  }
  panel.replaceChildren();
  const icon = document.createElement('div');
  icon.className = 'amble-oops-icon';
  icon.textContent = '!';
  const body = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = title;
  const msg = document.createElement('div');
  msg.className = 'amble-oops-msg';
  msg.textContent = message;
  body.append(b, msg);
  panel.append(icon, body);
}

export function hideErrorPanel(): void {
  panel?.remove();
  panel = null;
}

let chip: HTMLButtonElement | null = null;

/** A "Tap for sound" chip; clicking it is the gesture that unlocks audio. */
export function showSoundChip(onTap: () => void): void {
  ensureStyle();
  if (chip) return;
  chip = document.createElement('button');
  chip.className = 'amble-sound';
  chip.type = 'button';
  chip.textContent = '🔈 Tap for sound';
  chip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onTap();
    hideSoundChip();
  });
  document.body.append(chip);
}

export function hideSoundChip(): void {
  chip?.remove();
  chip = null;
}
