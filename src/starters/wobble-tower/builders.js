// Wobble Tower's helpers: the stickman builders, the tower's height, the wobble wind, ball rain and the mega bomb.

const FLOOR = 512;
const HOOK_Y = 110;
const HOMES = [110, 250, 850];

/** A builder stands at his spot, worried about your tower. */
function spawnBuilder(scene, x) {
  const b = scene.spawn(x, FLOOR - 44, 'dummy', { role: 'npc', friction: 0.9 });
  b.setFixedRotation();
  scene.homes.set(b, x);
  scene.builders.push(b);
  return b;
}

/** Hit hard, a builder flies apart at his joints... then he pulls himself together and gets back to work. */
function knockBuilder(scene, b, big) {
  scene.builders = scene.builders.filter((o) => o !== b);
  const doll = b.ragdoll({ break: big });
  // Up he goes, tumbling!
  for (const part of doll ? doll.parts : []) {
    part.setVelocity(part.body.velocity.x + scene.rand(-5, 5), scene.rand(-13, -7) * (big ? 1.4 : 1));
    part.setAngularVelocity(scene.rand(-0.3, 0.3));
  }
  scene.sfx(big ? 'explosion' : 'thud');
  scene.after(3500, () => {
    for (const part of doll ? doll.parts : []) {
      scene.fx.burst(part.x, part.y, { frames: ['star'], colors: [0xffd23f, 0xffffff], count: 4, speed: [30, 120], life: 400 });
      part.destroy();
    }
    const again = spawnBuilder(scene, scene.homes.get(b));
    scene.fx.squash(again, 0.6, 1.4, 160);
    scene.ui.say(again, scene.pick(['Ouch!', "I'm OK!", 'Boing!', 'Back to work!']), 1200);
  });
}

/** How tall the tower stands (crates still for most of a second), in meters: every goal reached moves the goal up. */
function measureTower(scene) {
  for (const c of scene.crates) c.still = c.active && c.body.speed < 0.4 ? (c.still ?? 0) + 1 : 0;
  const settled = scene.crates.filter((c) => c.still >= 3 && c.y < FLOOR);
  const top = settled.reduce((m, c) => Math.min(m, c.y - c.displayHeight / 2), FLOOR);
  const height = Math.round(((FLOOR - top) / 44) * 10) / 10;
  if (height === scene.height) return;
  scene.height = height;
  scene.best = Math.max(scene.best, height);
  scene.meter.setText(`TOWER ${height.toFixed(1)} m   BEST ${scene.best.toFixed(1)} m`);
  if (height < scene.goals[0]) return;
  scene.goals.shift();
  scene.fx.confetti(60);
  scene.sfx('win');
  if (!scene.goals.length) return scene.win('TALLEST TOWER IN TOWN!');
  scene.ui.big('GOAL!', { sub: 'The wind gets stronger...', color: '#86f3cb' });
  showGoal(scene);
}

/** The crane's rope, and the dotted goal line across the sky. */
function crane(scene) {
  scene.goalLine = scene.add.tileSprite(480, 0, 960, 6, 'amble-fx', 'dot').setTileScale(0.2, 0.2).setAlpha(0.7).setTint(0x86f3cb).setDepth(120);
  scene.goalText = scene.add.text(12, 0, '', { fontSize: '18px', color: '#86f3cb', fontStyle: 'bold' }).setOrigin(0, 1).setDepth(120);
  return scene.add.image(480, 0, 'amble-fx', 'line').setOrigin(0.5, 0).setTint(0x9aa5b8).setDepth(150);
}

/** A dotted line across the sky marks the next goal. */
function showGoal(scene) {
  const y = FLOOR - scene.goals[0] * 44;
  scene.goalLine.setY(y);
  scene.goalText.setY(y - 4).setText(`GOAL ${scene.goals[0]} m`);
}

/** The wobble wind: a gust pushes the crates sideways for a moment, a bit harder every time. */
function gust(scene) {
  scene.windDir = scene.windDir > 0 ? -1 : 1;
  scene.windUntil = scene.clock + 1500;
  scene.gusts++;
  const fromLeft = scene.windDir > 0;
  const streaks = scene.add.particles(fromLeft ? -20 : 980, 0, 'amble-fx', {
    frame: 'spark', y: { min: 40, max: 500 }, speedX: fromLeft ? { min: 900, max: 1400 } : { min: -1400, max: -900 },
    lifespan: 900, scaleX: 2.2, scaleY: 0.25, alpha: { start: 0.55, end: 0 }, quantity: 2, frequency: 25, tint: 0xcfe8ff,
  }).setDepth(900);
  scene.after(1500, () => streaks.stop());
  scene.after(2600, () => streaks.destroy());
  scene.ui.big(fromLeft ? 'WOBBLE WIND >>>' : '<<< WOBBLE WIND', { size: 40, y: 0.22, ms: 1100, color: '#cfe8ff' });
  scene.sfx('dash', { pitch: 0.5, volume: 0.6 });
}

/** R: a rain of beach balls (each one pops after a few seconds, so the game stays quick). */
function ballRain(scene) {
  const n = Math.max(40, 150 - scene.matter.world.getAllBodies().length);
  scene.ui.big('BALL RAIN!', { ms: 800, size: 60, color: '#4cc9f0' });
  for (let i = 0; i < n; i++) {
    scene.after(i * 12, () => {
      const r = scene.rand(9, 16);
      const tex = scene.art('ball');
      const half = scene.textures.getFrame(tex).width / 2;
      const ball = scene.matter.add.image(scene.rand(40, 920), scene.rand(-60, 20), tex, undefined, { shape: { type: 'circle', radius: half }, restitution: 0.7, friction: 0.05 });
      ball.setScale(r / half).setDepth(210);
      scene.after(5000 + scene.rand(0, 1500), () => {
        if (!ball.active) return;
        scene.fx.burst(ball.x, ball.y, { colors: [0xffffff, 0x4cc9f0], count: 5, speed: [40, 140], life: 250, size: 0.4 });
        ball.destroy();
      });
    });
  }
}

/** B: a huge slow-motion bomb where the pointer is. Builders nearby fly apart at the joints. */
function megaBomb(scene) {
  const p = scene.input.activePointer;
  const x = p.worldX || 480;
  const y = p.worldY || 300;
  scene.ui.big('MEGA BOMB', { ms: 700, color: '#ff8c42' });
  scene.fx.slowmo(0.2, 1200);
  scene.after(120, () => {
    for (const b of [...scene.builders]) if (scene.dist(b, { x, y }) < 260) knockBuilder(scene, b, true);
    scene.fx.explode(x, y, { size: 2.6, power: 2.6 * scene.dials.blast, radius: 380 });
    scene.fx.flash('#ffffff', 220, 0.6);
  });
}
