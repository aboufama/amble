/**
 * Amble player: runs inside a sandboxed iframe (or a standalone exported HTML file).
 * Boots one Phaser game, then builds/starts/stops Amble games in it on request (each in a scene of its own).
 */
import * as Phaser from 'phaser';
import { STAGE_HEIGHT, STAGE_WIDTH, type RunPackage, type ToPlayer } from '../player/protocol';
import { forwardConsole, onEditorMessage, post, reportError, resetReports } from './bridge';
import { clearGameTimers } from './sandbox';
import { Game, type GameHost, type GameState } from './game';
import type { Sprite } from './sprite';
import { UI_CSS } from './ui';

const standalone = window.parent === window;

const style = document.createElement('style');
style.textContent = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #111; }
#amble-viewport { position: absolute; overflow: hidden; background: #fff; }
#amble-viewport canvas { position: absolute; left: 0; top: 0; outline: none; touch-action: none; display: block; }
#amble-ui-host { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.amble-loading { position: absolute; inset: 0; display: grid; place-items: center; font: 600 14px system-ui, sans-serif; color: #888; }
.amble-start { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.35); cursor: pointer; }
.amble-start button { font: 700 22px system-ui, sans-serif; padding: 14px 34px; border-radius: 40px; border: none; background: #4cbf56; color: white; box-shadow: 0 5px 0 #2f8a37; cursor: pointer; }
${UI_CSS}
`;
document.head.append(style);

const viewport = document.createElement('div');
viewport.id = 'amble-viewport';
const uiHost = document.createElement('div');
uiHost.id = 'amble-ui-host';
viewport.append(uiHost);
document.body.append(viewport);

/** Canvas pixels per stage pixel: the stage is drawn at the screen's own resolution, so it stays sharp at any size. */
let pixelScale = 1;

/** Letterboxes the 4:3 stage into the window, sizes the canvas to match it in real pixels and scales the UI layer. */
function layout(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT);
  const vw = Math.max(1, Math.floor(STAGE_WIDTH * scale));
  const vh = Math.max(1, Math.floor(STAGE_HEIGHT * scale));
  viewport.style.width = `${vw}px`;
  viewport.style.height = `${vh}px`;
  viewport.style.left = `${Math.floor((w - vw) / 2)}px`;
  viewport.style.top = `${Math.floor((h - vh) / 2)}px`;
  const uiRoot = uiHost.firstElementChild as HTMLElement | null;
  if (uiRoot) uiRoot.style.transform = `scale(${vw / STAGE_WIDTH})`;
  if (!phaser) return;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.round(vw * dpr));
  const ph = Math.max(1, Math.round(vh * dpr));
  if (phaser.scale.width !== pw || phaser.scale.height !== ph) phaser.scale.resize(pw, ph);
  phaser.scale.setZoom(1 / dpr);
  pixelScale = pw / STAGE_WIDTH;
}

let phaser: Phaser.Game | null = null;
let booting: Promise<Phaser.Game> | null = null;
let canvas: HTMLCanvasElement | null = null;

/** The player's Phaser game, booted once (the WebGL context and Phaser's systems are reused by every game). */
function bootPhaser(): Promise<Phaser.Game> {
  booting ??= new Promise((resolve) => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: viewport,
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
      backgroundColor: '#ffffff',
      banner: false,
      // Sound plays through Amble's own mixer (so Stop silences everything at once).
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.NONE },
      render: { antialias: true, powerPreference: 'high-performance' },
      disableContextMenu: true,
      // Never take focus from the editor around the stage (the stage takes it when it is clicked or played).
      autoFocus: false,
      callbacks: {
        postBoot: (booted) => {
          phaser = booted;
          canvas = booted.canvas;
          canvas.tabIndex = 0;
          canvas.id = 'amble-canvas';
          // The UI layer (scores, bubbles, buttons) stays above the canvas.
          viewport.append(uiHost);
          layout();
          if (!standalone) enableDragging(canvas);
          resolve(booted);
        },
      },
    });
    void game;
  });
  return booting;
}

let game: Game | null = null;
let lastPackage: RunPackage | null = null;
let loadSeq = 0;
/** A load that will start the game is in progress. */
let starting = false;

const host = (booted: Phaser.Game): GameHost => ({
  Phaser,
  phaser: booted,
  canvas: canvas!,
  uiParent: uiHost,
  scale: () => pixelScale,
  onStateChange(state: GameState) {
    post({ type: 'status', state });
  },
  requestRestart() {
    setTimeout(() => void load(lastPackage, true), 0);
  },
});

async function load(pkg: RunPackage | null, start: boolean): Promise<void> {
  if (!pkg) return;
  // Editor previews never interrupt a game that is running (or about to).
  if (!start && (starting || game?.state === 'running' || game?.state === 'paused')) {
    lastPackage = pkg;
    return;
  }
  const seq = ++loadSeq;
  lastPackage = pkg;
  if (start) starting = true;
  const loading = document.createElement('div');
  loading.className = 'amble-loading';
  loading.textContent = 'Loading…';
  if (!game) viewport.append(loading);
  try {
    const booted = await bootPhaser();
    if (seq !== loadSeq) return;
    game?.dispose();
    game = null;
    clearGameTimers();
    resetReports();
    const next = await Game.create(host(booted), pkg);
    if (seq !== loadSeq) {
      next.dispose();
      return;
    }
    game = next;
    (window as unknown as { __ambleGame?: Game }).__ambleGame = next;
    layout();
    post({ type: 'loaded' });
    post({ type: 'status', state: 'idle' });
    if (start) {
      canvas?.focus();
      game.start();
    }
  } catch (err) {
    reportError(err, { phase: 'load' });
  } finally {
    loading.remove();
    if (seq === loadSeq) starting = false;
  }
}

function stop(): void {
  clearGameTimers();
  game?.stop();
}

function handle(msg: ToPlayer): void {
  switch (msg.type) {
    case 'load':
      void load(msg.pkg, msg.start);
      break;
    case 'greenFlag':
      // Always start from a fresh copy of the game so every run is identical.
      void load(lastPackage, true);
      break;
    case 'stop':
      stop();
      break;
    case 'key':
      if (msg.phase === 'down') game?.input.keyDown(msg.key === ' ' ? 'space' : keyNameFrom(msg.key, msg.code));
      else game?.input.keyUp(msg.key === ' ' ? 'space' : keyNameFrom(msg.key, msg.code));
      break;
    case 'releaseKeys':
      game?.input.releaseAll();
      break;
    case 'pointerUp':
      endStageDrag();
      break;
  }
}

function keyNameFrom(key: string, code: string): string {
  if (code?.startsWith('Digit')) return code.slice(5);
  if (code?.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  return key;
}

/**
 * In the editor, sprites on a stage that isn't running can be dragged into place, like
 * Scratch; the editor then stores their new start position.
 */
let endStageDrag = (): void => {};

function enableDragging(canvas: HTMLCanvasElement): void {
  let drag: { sprite: Sprite; dx: number; dy: number; moved: boolean } | null = null;
  const at = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const draggable = () => game && (game.state === 'idle' || game.state === 'stopped');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !draggable()) return;
    const p = at(e);
    const sprite = game!.spriteAt(p.x, p.y);
    if (!sprite) return;
    const point = game!.stagePointAt(p.x, p.y);
    drag = { sprite, dx: sprite.x - point.x, dy: sprite.y - point.y, moved: false };
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) {
      const p = at(e);
      canvas.style.cursor = draggable() && game!.spriteAt(p.x, p.y) ? 'grab' : '';
      return;
    }
    const point = game!.stagePointAt(at(e).x, at(e).y);
    drag.sprite.setPosition(
      Math.round(Math.max(-STAGE_WIDTH / 2, Math.min(STAGE_WIDTH / 2, point.x + drag.dx))),
      Math.round(Math.max(-STAGE_HEIGHT / 2, Math.min(STAGE_HEIGHT / 2, point.y + drag.dy))),
    );
    drag.moved = true;
  });
  const end = () => {
    if (drag?.moved) post({ type: 'spriteMoved', name: drag.sprite.name, x: drag.sprite.x, y: drag.sprite.y });
    drag = null;
    canvas.style.cursor = '';
  };
  endStageDrag = end;
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

window.addEventListener('resize', layout);
forwardConsole();

if (standalone) {
  // Exported game: data is embedded in the page.
  const pkgEl = document.getElementById('amble-package');
  if (pkgEl) {
    const pkg = JSON.parse(pkgEl.textContent ?? '{}') as RunPackage;
    document.title = pkg.title || 'Amble game';
    void load(pkg, false).then(() => {
      const overlay = document.createElement('div');
      overlay.className = 'amble-start';
      const button = document.createElement('button');
      button.textContent = '▶ Play';
      overlay.append(button);
      viewport.append(overlay);
      overlay.addEventListener('click', () => {
        overlay.remove();
        canvas?.focus();
        game?.start();
      });
    });
  }
} else {
  onEditorMessage(handle);
  void bootPhaser();
  post({ type: 'hello' });
}
