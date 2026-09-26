/**
 * Amble player: runs inside a sandboxed iframe (or a standalone exported HTML file).
 * Boots Babylon.js + Havok once, then builds/starts/stops games on request.
 */
import HavokPhysics from '@babylonjs/havok';
import { Engine } from './babylon';
import { STAGE_HEIGHT, STAGE_WIDTH, type RunPackage, type ToPlayer } from '../player/protocol';
import { forwardConsole, onEditorMessage, post, reportError, resetReports } from './bridge';
import { clearGameTimers } from './sandbox';
import { Game, type GameHost, type GameState } from './game';
import { UI_CSS } from './ui';

const standalone = window.parent === window;

const style = document.createElement('style');
style.textContent = `
html, body { margin: 0; height: 100%; overflow: hidden; background: #111; }
#amble-viewport { position: absolute; overflow: hidden; background: #fff; }
#amble-canvas { position: absolute; inset: 0; width: 100%; height: 100%; outline: none; touch-action: none; display: block; }
#amble-ui-host { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.amble-loading { position: absolute; inset: 0; display: grid; place-items: center; font: 600 14px system-ui, sans-serif; color: #888; }
.amble-start { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,0.35); cursor: pointer; }
.amble-start button { font: 700 22px system-ui, sans-serif; padding: 14px 34px; border-radius: 40px; border: none; background: #4cbf56; color: white; box-shadow: 0 5px 0 #2f8a37; cursor: pointer; }
${UI_CSS}
`;
document.head.append(style);

const viewport = document.createElement('div');
viewport.id = 'amble-viewport';
const canvas = document.createElement('canvas');
canvas.id = 'amble-canvas';
canvas.tabIndex = 0;
const uiHost = document.createElement('div');
uiHost.id = 'amble-ui-host';
viewport.append(canvas, uiHost);
document.body.append(viewport);

/** Letterboxes the 4:3 stage into the window and scales the UI layer to match. */
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
  engine?.resize();
}

let engine: Engine | null = null;
let havok: unknown = null;
let havokReady: Promise<unknown> | null = null;
let resolveHavokBytes: (bytes: ArrayBuffer) => void = () => {};
const havokBytes = new Promise<ArrayBuffer>((resolve) => {
  resolveHavokBytes = resolve;
});

let game: Game | null = null;
let lastPackage: RunPackage | null = null;
let loadSeq = 0;

function initEngine(): Engine {
  if (engine) return engine;
  engine = new Engine(
    canvas,
    true,
    {
      deterministicLockstep: true,
      lockstepMaxSteps: 4,
      timeStep: 1 / 60,
      stencil: true,
      preserveDrawingBuffer: false,
      audioEngine: false,
    },
    true,
  );
  engine.runRenderLoop(() => {
    if (game) game.render();
  });
  layout();
  return engine;
}

async function getHavok(): Promise<unknown> {
  if (!havokReady) {
    havokReady = havokBytes.then((bytes) =>
      HavokPhysics({ wasmBinary: bytes, locateFile: () => 'HavokPhysics.wasm' } as never),
    );
  }
  havok = await havokReady;
  return havok;
}

const host = (): GameHost => ({
  engine: initEngine(),
  canvas,
  uiParent: uiHost,
  havok,
  onStateChange(state: GameState) {
    post({ type: 'status', state });
  },
  requestRestart() {
    setTimeout(() => void load(lastPackage, true), 0);
  },
});

async function load(pkg: RunPackage | null, start: boolean): Promise<void> {
  if (!pkg) return;
  const seq = ++loadSeq;
  lastPackage = pkg;
  const loading = document.createElement('div');
  loading.className = 'amble-loading';
  loading.textContent = 'Loading…';
  if (!game) viewport.append(loading);
  try {
    await getHavok();
    if (seq !== loadSeq) return;
    game?.dispose();
    game = null;
    clearGameTimers();
    resetReports();
    const next = await Game.create(host(), pkg);
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
      canvas.focus();
      game.start();
    }
  } catch (err) {
    reportError(err, { phase: 'load' });
  } finally {
    loading.remove();
  }
}

function stop(): void {
  clearGameTimers();
  game?.stop();
}

function handle(msg: ToPlayer): void {
  switch (msg.type) {
    case 'init':
      resolveHavokBytes(msg.havokWasm);
      break;
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
  }
}

function keyNameFrom(key: string, code: string): string {
  if (code?.startsWith('Digit')) return code.slice(5);
  if (code?.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  return key;
}

window.addEventListener('resize', layout);
forwardConsole();

if (standalone) {
  // Exported game: data is embedded in the page.
  const pkgEl = document.getElementById('amble-package');
  const havokEl = document.getElementById('amble-havok');
  if (pkgEl && havokEl) {
    const pkg = JSON.parse(pkgEl.textContent ?? '{}') as RunPackage;
    const b64 = (havokEl.textContent ?? '').trim();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    resolveHavokBytes(bin.buffer);
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
        canvas.focus();
        game?.start();
      });
    });
  }
} else {
  onEditorMessage(handle);
  post({ type: 'hello' });
}
