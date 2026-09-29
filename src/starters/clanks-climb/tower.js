// Clank's tower, the rising goo, and the rocket at the top.

const TOWER_H = 2400;
const TOP_Y = 230;

/** Girders zig-zag up the tower, with gears to grab and Spikies patrolling some of them. Returns the rocket and Buddy's spot. */
function buildTower(scene) {
  let buddySpot = null;
  scene.worldSize(960, TOWER_H);
  scene.platform(480, TOWER_H - 16, 960, 32, 'girder');
  let x = 480;
  let i = 0;
  for (let y = TOWER_H - 140; y > TOP_Y + 60; y -= scene.rand(96, 122)) {
    x = Phaser.Math.Clamp(x + scene.pick([-1, 1]) * scene.rand(170, 300), 110, 850);
    const w = scene.rand(140, 230);
    scene.platform(x, y, w, 16, 'girder', { oneWay: true });
    if (i % 3 === 2) {
      const s = scene.spawnEnemy(x, y - 40, 'spiky', { hp: 1 });
      s.patrol(() => scene.dials.spikySpeed, { min: x - w / 2 + 16, max: x + w / 2 - 16 });
    } else if (scene.chance(0.7)) {
      scene.spawnItem(x + scene.rand(-40, 40), y - 50, 'gear', { points: 25, float: 6 });
    }
    if (i === 9) buddySpot = { x, y: y - 40 };
    i++;
  }
  // The launch pad and the rocket, right at the top.
  scene.platform(480, TOP_Y, 260, 20, 'girder', { oneWay: true });
  const rocket = scene.spawn(480, TOP_Y - 72, 'rocket', { role: 'prop', gravity: false, immovable: true });
  return { rocket, buddySpot };
}

/** The goo: your drawing tiled across, with deeper copies below it (each hides the next one's surface), bubbling. */
function makeGoo(scene) {
  scene.bubbles = scene.add.particles(0, 0, 'amble-fx', {
    frame: 'ring', x: { min: 10, max: 950 }, y: { min: 4, max: 30 }, speedY: { min: -50, max: -15 }, lifespan: 1000,
    scale: { start: 0.12, end: 0.3 }, alpha: { start: 0.9, end: 0 }, tint: [0xd4f98a, 0x8fdc45], frequency: 70,
  }).setDepth(601);
  return [0, 1, 2, 3, 4].map((k) => scene.add.tileSprite(480, 0, 960, 128, scene.art('goo')).setOrigin(0.5, 0).setDepth(600 - k).setTilePosition(k * 77, 0));
}

/** The goo waits 4 seconds, then creeps up (slowly at first), never too far below the screen, sloshing as it goes. */
function riseGoo(scene, dt) {
  const view = scene.cameras.main.worldView;
  const speed = scene.dials.gooSpeed * Phaser.Math.Clamp((scene.clock - 4000) / 6000, 0, 1);
  scene.gooY -= speed * dt;
  // The camera's view is known after its first frame: from then on the goo keeps up with you.
  if (view.height > 0) scene.gooY = Math.min(scene.gooY, view.bottom + 160);
  scene.bubbles.setY(scene.gooY);
  scene.goo.forEach((strip, k) => strip.setPosition(480, scene.gooY + k * 80).setTilePosition(k * 77 + Math.sin(scene.clock / 700 + k) * 20, 0));
}

/** Touching the goo stings: lose a heart and bounce way up out of it. */
function gooBurn(scene, p) {
  if (!p.damage(1, { knockback: 0 })) return;
  p.setVelocityY(-1100);
  scene.fx.burst(p.x, scene.gooY + 30, { colors: [0x8fdc45, 0xd4f98a], count: 18, speed: [80, 320], angle: [200, 340], life: 600 });
  scene.ui.pop(p.x, p.y - 40, 'HOT GOO!', { color: '#8fdc45', size: 26 });
}

/** Up at the top: Clank climbs in and the rocket blasts off to the stars. */
function blastOff(scene) {
  const p = scene.player;
  const r = scene.rocket;
  scene.launched = true;
  p.setVisible(false).setVelocity(0, 0);
  p.body.enable = false;
  scene.fx.shake(0.02, 1600);
  scene.sfx('explosion');
  scene.ui.big('BLAST OFF!', { color: '#ffd23f' });
  scene.fx.trail(r, { color: 0xffb347, life: 500, size: 1.4 });
  scene.cameras.main.stopFollow();
  scene.tweens.add({ targets: r, y: r.y - 900, duration: 2200, ease: 'Quad.easeIn' });
  scene.tweens.add({ targets: scene.cameras.main, scrollY: scene.cameras.main.scrollY - 500, duration: 2200, ease: 'Quad.easeIn' });
  scene.after(1600, () => scene.win('TO THE STARS!'));
}
