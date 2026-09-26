/** Manual/automated smoke test for the player runtime (open /dev/engine-test.html in `npm run dev`). */
import { PlayerHost } from '../src/player/host';
import type { RunCostume, RunPackage, RunTarget } from '../src/player/protocol';

const svg = (w: number, h: number, body: string) =>
  'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

const costume = (name: string, w: number, h: number, body: string): RunCostume => ({
  name, kind: 'image', url: svg(w, h, body), isVector: true, resolution: 1, centerX: w / 2, centerY: h / 2, width: w, height: h,
});

const target = (t: Partial<RunTarget> & { name: string; kind: RunTarget['kind'] }): RunTarget => ({
  className: null, code: null, costumes: [], sounds: [], costumeNumber: 1, x: 0, y: 0, z: 0, size: 100,
  direction: 0, visible: true, rotationStyle: 'all around', layerOrder: 1, ...t,
});

const playerCode = `class Player extends Sprite {
  start() {
    this.speed = 220;
    this.addPhysics({ fixedRotation: true });
    this.say('Hi!');
    this.game.vars.score = 0;
    this.game.ui.value('Score', () => this.game.vars.score);
  }
  update(dt) {
    this.velocity.x = this.game.input.axis('horizontal') * this.speed;
    if (this.game.input.wasPressed('space') && this.isOnGround()) this.velocity.y = 650;
    if (this.touching('Coin')) { const c = this.touching('Coin'); c.destroy(); this.game.vars.score++; this.game.effects.burst({ x: c.x, y: c.y }); }
    window.__amble = { x: this.x, y: this.y, score: this.game.vars.score, time: this.game.time, onGround: this.isOnGround() };
  }
}`;

const groundCode = `class Ground extends Sprite { start() { this.addPhysics({ type: 'static' }); } }`;
const coinCode = `class Coin extends Sprite {
  start() { this.hide(); this.every(0.5, () => { if (this.game.count('Coin') < 4) this.game.spawn('Coin', { x: this.random(-200, 200), y: this.random(-40, 120) }); }); }
  onSpawn() { this.animate(); }
  update(dt) { this.turn(90 * dt); }
}`;

const pkg2d: RunPackage = {
  mode: '2d',
  title: '2D test',
  targets: [
    target({ name: 'Stage', kind: 'stage', costumes: [costume('sky', 480, 360, '<rect width="480" height="360" fill="#bfe3ff"/>')] }),
    target({ name: 'Ground', kind: 'sprite', className: 'Ground', code: groundCode, y: -160, layerOrder: 1,
      costumes: [costume('ground', 480, 40, '<rect width="480" height="40" fill="#5a3"/>')] }),
    target({ name: 'Player', kind: 'sprite', className: 'Player', code: playerCode, y: 0, layerOrder: 2,
      costumes: [costume('a', 40, 60, '<rect width="40" height="60" rx="8" fill="#f80" stroke="#630" stroke-width="4"/>')] }),
    target({ name: 'Coin', kind: 'sprite', className: 'Coin', code: coinCode, layerOrder: 3,
      costumes: [costume('c1', 24, 24, '<circle cx="12" cy="12" r="10" fill="gold" stroke="#a80" stroke-width="3"/>'),
                 costume('c2', 24, 24, '<ellipse cx="12" cy="12" rx="5" ry="10" fill="gold" stroke="#a80" stroke-width="3"/>')] }),
  ],
};

const player3dCode = `class Hero extends Sprite {
  start() {
    this.addPhysics({ shape: 'capsule', fixedRotation: true });
    this.game.camera.follow(this, { distance: 6, height: 3 });
    this.game.world.fog('#dff1ff', 0.01);
  }
  update(dt) {
    const input = this.game.input;
    this.turn(input.axis('horizontal') * 120 * dt);
    const f = input.axis('vertical') * 5;
    const h = this.heading * Math.PI / 180;
    this.velocity.x = Math.sin(h) * f; this.velocity.z = Math.cos(h) * f;
    if (input.wasPressed('space') && this.isOnGround()) this.velocity.y = 8;
    window.__amble = { x: this.x, y: this.y, z: this.z, heading: this.heading, onGround: this.isOnGround(), time: this.game.time };
  }
}`;
const crate3dCode = `class Crate extends Sprite { start() { this.addPhysics({ mass: 2 }); } }`;

const pkg3d: RunPackage = {
  mode: '3d',
  title: '3D test',
  targets: [
    target({ name: 'Stage', kind: 'stage' }),
    target({ name: 'Hero', kind: 'sprite', className: 'Hero', code: player3dCode, y: 1,
      costumes: [costume('hero', 60, 120, '<rect width="60" height="120" rx="20" fill="#48f" stroke="#124" stroke-width="5"/>')] }),
    target({ name: 'Crate', kind: 'sprite', className: 'Crate', code: crate3dCode, x: 2, y: 3, z: 3,
      costumes: [{ name: 'box', kind: 'model', url: '', isVector: false, resolution: 1, centerX: 0, centerY: 0, width: 0, height: 0,
        recipe: { parts: [
          { shape: 'box', size: [1, 1, 1], position: [0, 0.5, 0], rotation: [0, 0, 0], color: '#b5793b', roughness: 0.8, metalness: 0, emissive: 0, opacity: 1 },
          { shape: 'sphere', size: [0.4, 0.4, 0.4], position: [0, 1.15, 0], rotation: [0, 0, 0], color: '#ff4466', roughness: 0.3, metalness: 0, emissive: 0.2, opacity: 1 },
        ] } }] }),
  ],
};

const log = document.getElementById('log')!;
const write = (s: string) => { log.textContent += s + '\n'; };
const w = window as unknown as Record<string, unknown>;
w.__events = [] as unknown[];
const host = new PlayerHost(document.getElementById('stage')!, {
  onState: (s) => { write('state: ' + s); (w.__events as unknown[]).push({ state: s }); },
  onLoaded: () => { write('loaded'); (w.__events as unknown[]).push({ loaded: true }); },
  onError: (e) => { write('ERROR ' + JSON.stringify(e)); (w.__events as unknown[]).push({ error: e }); },
  onLog: (l, m) => { write(`[${l}] ${m}`); (w.__events as unknown[]).push({ log: m }); },
});
w.__host = host;
w.__pkgs = { pkg2d, pkg3d };
document.getElementById('load2d')!.onclick = () => host.load(pkg2d, false);
document.getElementById('load3d')!.onclick = () => host.load(pkg3d, false);
document.getElementById('go')!.onclick = () => host.greenFlag();
document.getElementById('stop')!.onclick = () => host.stop();
