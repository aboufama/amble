// Sky Run's world, built one screen at a time just ahead of the runner (so it never ends).

const FLOOR_Y = 500;
const CEILING_Y = 20;

/** One screen of sky: cloud floors and ceilings with gaps, Bloops, glims, and now and then a portal or a giant gem. */
function makeChunk(scene, x0, i) {
  const end = x0 + 960;
  const gapSize = () => (i === 0 ? 0 : scene.rand(90, 150 + Math.min(i, 20) * 3) * (scene.dials.gap / 100));
  // The floor: long clouds with gaps to jump. The first chunk is one safe cloud.
  while (scene.floorX < end) {
    const w = i === 0 ? 1400 : scene.rand(280, 560);
    const gap = gapSize();
    scene.platform(scene.floorX + w / 2, FLOOR_Y + 40, w, 80, 'cloud');
    if (i > 1 && scene.chance(0.5)) addBloop(scene, scene.floorX, w, FLOOR_Y - 30);
    if (gap > 40) glimArc(scene, scene.floorX + w, gap, false);
    scene.floorX += w + gap;
  }
  // The ceiling, for when a flip portal turns the world upside down.
  while (scene.ceilX < end) {
    const w = scene.rand(320, 620);
    const gap = i < 2 || scene.ceilX < scene.safeCeiling ? 0 : gapSize() * 0.8;
    scene.platform(scene.ceilX + w / 2, CEILING_Y - 20, w, 80, 'cloud').setFlipY(true);
    if (gap > 40 && scene.chance(0.6)) glimArc(scene, scene.ceilX + w, gap, true);
    scene.ceilX += w + gap;
  }
  if (i > 0 && i % 3 === 1) addPortal(scene, x0 + scene.rand(300, 700));
  else if (i > 0 && i % 5 === 3) addGiantGem(scene, x0 + scene.rand(250, 700));
}

/** A Bloop bounces along a cloud. Stomp it! */
function addBloop(scene, left, w, y) {
  const b = scene.spawnEnemy(left + w * scene.rand(0.4, 0.8), scene.gravityFlipped ? CEILING_Y + 30 : y, 'bloop', { hp: 1 });
  b.patrol(70, { min: left + 30, max: left + w - 30 });
}

/** Glims in an arc over a gap: jump through them for a combo. */
function glimArc(scene, x, gap, ceiling) {
  const n = Math.round(scene.dials.arcs);
  for (let k = 0; k < n; k++) {
    const f = n > 1 ? k / (n - 1) : 0.5;
    const lift = Math.sin(f * Math.PI) * 90;
    scene.spawnItem(x - 30 + (gap + 60) * f, ceiling ? 130 + lift : 400 - lift, 'glim', { points: 10 });
  }
}

/** A flip portal: run through it and the world turns upside down (in slow motion). */
function addPortal(scene, x) {
  scene.safeCeiling = x + 2600;
  let used = false;
  const p = scene.spawnItem(x, 270, 'portal', {
    onPickup: () => {
      if (used) return false;
      used = true;
      scene.flip();
      return false;
    },
  });
  scene.tweens.add({ targets: p, angle: { from: -6, to: 6 }, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
  scene.fx.halo(p, 0xff5ea8, 3);
}

/** A giant gem: grab it and you grow huge and smash everything for six seconds. */
function addGiantGem(scene, x) {
  const gem = scene.spawnItem(x, scene.gravityFlipped ? 200 : 330, 'glim', { scale: 1.8, float: 12, points: 100, onPickup: () => scene.giantMode() });
  gem.setTint(0xffd23f);
  scene.fx.halo(gem, 0xffd23f, 3.4);
}

/** Kite (only once drawn) swoops in and carries you over the gap you fell into. Once per run. */
function kiteRescue(scene, p) {
  scene.kiteUsed = true;
  const kite = scene.spawn(p.x - 160, p.y - 260, 'kite', { role: 'npc', gravity: false, body: false });
  p.setVelocity(scene.dials.speed * 1.2, -1150 * (scene.gravityFlipped ? -1 : 1));
  scene.ui.big('KITE TO THE RESCUE!', { size: 48, color: '#9ff3ff', ms: 900 });
  scene.sfx('powerup');
  scene.tweens.add({ targets: kite, x: p.x + 520, y: p.y - 520, duration: 1400, ease: 'Sine.easeIn', onComplete: () => kite.destroy() });
}
