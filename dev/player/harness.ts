/**
 * Harness for the player core: runs the fixture games in the real sandboxed player, with buttons for the
 * live features, and `window.harness` for the Playwright checks (e2e/player.spec.ts).
 */
import runtimeUrl from 'virtual:amble-runtime';
import { buildStandaloneHtml, loadRuntimeText, Player, type DrawnArt, type GameBundle, type PlayerPrefs, type RobotReport } from '../../src/play/index';
import { FIXTURES, type FixtureName } from '../../src/runtime/fixtures/index';

const stage = document.getElementById('stage') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLPreElement;
const statsEl = document.getElementById('stats') as HTMLPreElement;
const select = document.getElementById('fixture') as HTMLSelectElement;

const player = new Player({ container: stage, runtimeUrl, title: 'Harness game' });
const log: Array<{ t: number; type: string; data: unknown }> = [];

function note(type: string, data: unknown): void {
  log.push({ t: Math.round(performance.now()), type, data });
  if (type === 'stats') return;
  const line = `${type} ${typeof data === 'string' ? data : JSON.stringify(data)?.slice(0, 300)}\n`;
  logEl.textContent = (line + (logEl.textContent ?? '')).slice(0, 20000);
}

player.on('state', (s) => note('state', s));
player.on('firstFrame', (ms) => note('firstFrame', ms));
player.on('booted', (b) => note('booted', b));
player.on('error', (e) => note('error', e));
player.on('warn', (m, w) => note('warn', { m, ...w }));
player.on('log', (level, m) => note('log', `${level}: ${m}`));
player.on('event', (e) => note('event', e));
player.on('artMissing', (n) => note('artMissing', n.key));
player.on('artClicked', (key, rect) => note('artClicked', { key, rect }));
player.on('swapped', (s) => note('swapped', s));
player.on('csp', (c) => note('csp', c));
player.on('navigated', () => note('navigated', ''));
player.on('audio', (a) => note('audio', a));
player.on('stats', (s) => {
  note('stats', s);
  statsEl.textContent = JSON.stringify(s, null, 1);
});
player.on('manifest', (m) => {
  note('manifest', { title: m.title, art: m.art.map((a) => a.key), dials: m.dials.map((d) => d.key), controls: m.controls });
  renderDials();
});

/** A stand-in for a student's drawing: a marker doodle of a round little hero (a face is fine here). */
function drawing(kind: 'hero' | 'blob' | 'boss' | 'coin' = 'hero'): Promise<Blob> {
  const c = document.createElement('canvas');
  const big = kind === 'boss';
  c.width = big ? 440 : kind === 'coin' ? 80 : 200;
  c.height = big ? 380 : kind === 'coin' ? 80 : 320;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = big ? 10 : 7;
  g.strokeStyle = '#221c18';
  const fill = (color: string, draw: () => void) => {
    g.beginPath();
    draw();
    g.fillStyle = color;
    g.fill();
    g.stroke();
  };
  if (kind === 'coin') {
    fill('#ffd23f', () => g.arc(40, 40, 32, 0, Math.PI * 2));
    g.beginPath();
    g.moveTo(40, 22);
    g.lineTo(40, 58);
    g.stroke();
  } else if (kind === 'hero') {
    fill('#3d7bf2', () => g.ellipse(70, 280, 22, 34, 0, 0, Math.PI * 2));
    fill('#3d7bf2', () => g.ellipse(130, 280, 22, 34, 0, 0, Math.PI * 2));
    fill('#e8423f', () => g.roundRect(45, 140, 110, 130, 40));
    fill('#ffd23f', () => g.arc(100, 90, 62, 0, Math.PI * 2));
    fill('#ffffff', () => g.arc(80, 82, 13, 0, Math.PI * 2));
    fill('#ffffff', () => g.arc(122, 82, 13, 0, Math.PI * 2));
    fill('#221c18', () => g.arc(84, 84, 5, 0, Math.PI * 2));
    fill('#221c18', () => g.arc(126, 84, 5, 0, Math.PI * 2));
    g.beginPath();
    g.arc(100, 108, 22, 0.2, Math.PI - 0.2);
    g.stroke();
  } else {
    const w = c.width;
    const h = c.height;
    fill(big ? '#8f6cf0' : '#3fbf5a', () => {
      g.moveTo(w * 0.08, h * 0.92);
      g.bezierCurveTo(w * 0.02, h * 0.2, w * 0.98, h * 0.2, w * 0.92, h * 0.92);
      g.closePath();
    });
    fill('#ffffff', () => g.arc(w * 0.38, h * 0.52, w * 0.08, 0, Math.PI * 2));
    fill('#ffffff', () => g.arc(w * 0.62, h * 0.52, w * 0.08, 0, Math.PI * 2));
    fill('#221c18', () => g.arc(w * 0.4, h * 0.54, w * 0.03, 0, Math.PI * 2));
    fill('#221c18', () => g.arc(w * 0.6, h * 0.54, w * 0.03, 0, Math.PI * 2));
  }
  return new Promise((resolve) => c.toBlob((b) => resolve(b as Blob), 'image/png'));
}

let current: FixtureName = 'boss';

function bundleFor(name: FixtureName, extra: Partial<GameBundle> = {}): GameBundle {
  return { files: [{ name: `${name}.js`, source: FIXTURES[name] }], ...extra };
}

async function load(name: FixtureName, extra: Partial<GameBundle> & { prefs?: Partial<PlayerPrefs> } = {}): Promise<void> {
  current = name;
  select.value = name;
  if (extra.prefs) player.setPrefs(extra.prefs);
  await player.load(bundleFor(name, extra));
}

async function swap(key = 'hero', kind: Parameters<typeof drawing>[0] = 'hero'): Promise<void> {
  const art: DrawnArt = { key, image: await drawing(kind) };
  player.swapArt(art);
}

function robot(name: FixtureName, options: { gameMs?: number; seed?: number; bot?: 'auto' | 'none'; art?: DrawnArt[]; twists?: string[] } = {}): Promise<RobotReport> {
  return player.robotTest(bundleFor(name, { art: options.art, twists: options.twists }), { gameMs: options.gameMs, seed: options.seed, bot: options.bot });
}

async function exportPage(name: FixtureName, art: DrawnArt[] = []): Promise<string> {
  const runtime = await loadRuntimeText(runtimeUrl);
  return buildStandaloneHtml({ title: `${name} (exported)`, runtime, files: bundleFor(name).files, images: art.map((a) => ({ key: a.key, image: a.image, rig: a.rig })) });
}

function renderDials(): void {
  const box = document.getElementById('dials') as HTMLDivElement;
  const tw = document.getElementById('twists') as HTMLDivElement;
  const m = player.manifest;
  box.replaceChildren();
  tw.replaceChildren();
  if (!m) return;
  for (const d of m.dials) {
    const l = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(d.min);
    input.max = String(d.max);
    input.step = String(d.step);
    input.value = String(d.current);
    input.oninput = () => player.setDial(d.key, Number(input.value));
    l.append(`${d.label}${d.live ? '' : ' (restarts)'}`, input);
    box.append(l);
  }
  for (const t of m.twists.filter((x) => x.available)) {
    const l = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = t.on;
    input.onchange = () => player.setTwist(t.id, input.checked);
    l.append(input, t.name);
    tw.append(l);
  }
}

for (const name of Object.keys(FIXTURES)) {
  const o = document.createElement('option');
  o.value = name;
  o.textContent = name;
  select.append(o);
}

const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
on('play', () => {
  player.focus();
  void load(select.value as FixtureName);
});
on('pause', () => player.pause());
on('resume', () => player.resume());
on('restartLevel', () => player.restartLevel());
on('restart', () => void player.restart());
on('swap', () => void swap('hero', 'hero'));
on('clear', () => player.clearArt('hero'));
on('robot', () => void robot(select.value as FixtureName).then((r) => note('robot', { pass: r.pass, reasons: r.reasons, frames: r.frames, speed: r.speed, wallMs: r.wallMs })));
on('export', () => void exportPage(select.value as FixtureName).then((html) => note('export', `${Math.round(html.length / 1024)} KB`)));
on('fullscreen', () => void player.requestFullscreen());

window.addEventListener('keydown', (e) => {
  if (player.forwardKey(e)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (player.forwardKey(e)) e.preventDefault();
});
window.addEventListener('blur', () => player.releaseKeys());

const harness = { player, log, load, swap, drawing, robot, exportPage, fixtures: Object.keys(FIXTURES), get current() { return current; } };
(window as unknown as { harness: typeof harness }).harness = harness;
