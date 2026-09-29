// The Moon King's big moves. game.js calls these from the boss's brain and its phases.

const FLOOR = 496;
const STAR_SPOTS = [[190, 336], [420, 246], [740, 346], [320, 452], [580, 452]];

/** Fires `times` volleys, 0.38 s apart, with the boss's attack move. */
function volley(scene, boss, times, fire) {
  for (let i = 0; i < times; i++) {
    scene.after(i * 380, () => {
      if (!boss.alive) return;
      boss.play('attack');
      fire();
    });
  }
}

/** THE SLAM: he rises off the screen, drops where you stand, and the ground throws orbs both ways. */
function slam(scene, boss, target) {
  scene.slamming = true;
  const x = Phaser.Math.Clamp(target.x, 140, 820);
  // A red ring on the ground shows where he will land: big attacks always warn you first.
  const warn = scene.add.image(x, FLOOR - 4, 'amble-fx', 'ring').setTint(0xff4d6d).setScale(3, 0.8).setAlpha(0);
  scene.tweens.add({ targets: warn, alpha: 0.9, yoyo: true, repeat: 3, duration: 180 });
  scene.sfx('roar');
  scene.tweens.chain({
    targets: boss,
    tweens: [
      { y: -150, duration: 450, ease: 'Back.easeIn' },
      { x, duration: 250 },
      { y: FLOOR - 112, duration: 280, ease: 'Quad.easeIn', delay: 350 },
    ],
    onComplete: () => {
      warn.destroy();
      if (!boss.alive) return;
      scene.fx.shake(0.03, 500);
      scene.fx.hitstop(120);
      scene.fx.shockwave(x, FLOOR, { radius: 380, color: 0xffd23f });
      scene.fx.burst(x, FLOOR, { frames: ['smoke'], colors: [0xd9d0ff, 0xffffff], count: 24, speed: [80, 420], angle: [180, 360], life: 700 });
      scene.sfx('boom');
      // Two waves of orbs roll along the ground: jump over them!
      for (const dir of [0, 180]) {
        for (let row = 0; row < 2; row++) scene.shoot({ x, y: FLOOR - 14 - row * 26, role: 'enemy' }, dir, { key: 'orb', speed: 330 + row * 40 });
      }
      scene.pattern.ring(boss, { key: 'orb', count: 12, speed: 260 });
      scene.tweens.add({ targets: boss, x: 720, y: 240, duration: 900, delay: 500, ease: 'Sine.easeInOut', onComplete: () => (scene.slamming = false) });
    },
  });
}

/** Grumbles hop down from the sky and bounce after you (stomp them!). */
function grumbleWave(scene, count) {
  for (let i = 0; i < count; i++) {
    scene.after(i * 450, () => {
      const g = scene.spawnEnemy(scene.rand(120, 840), -40, 'grumble', { hp: 2 });
      g.chase(scene.player, () => 90 + scene.rage * 40);
      scene.fx.burst(g.x, 12, { colors: [0xff5c8a, 0xffffff], count: 10, speed: [60, 200], angle: [30, 150] });
    });
  }
}

/** A star shard twinkles in somewhere you can reach it. */
function dropStar(scene) {
  const [x, y] = scene.pick(STAR_SPOTS);
  const star = scene.spawnItem(x, y, 'star', { float: 8, onPickup: () => superShots(scene) });
  scene.tweens.add({ targets: star, scale: { from: 0, to: star.scale }, angle: { from: -180, to: 0 }, duration: 500, ease: 'Back.easeOut' });
  scene.fx.halo(star, 0xffd23f, 2.6);
}

/** Star power: three big shots at a time, each three times as strong, for 8 seconds. */
function superShots(scene) {
  scene.power = 3;
  scene.ui.big('SUPER SHOTS!', { color: '#ffd23f', ms: 900 });
  scene.glow.setAlpha(1);
  scene.sfx('powerup');
  scene.after(8000, () => {
    scene.power = 1;
    scene.tweens.add({ targets: scene.glow, alpha: 0, duration: 400 });
  });
}

/** Bubbles (only once drawn) flies beside you and pops bubbles at the boss. */
function bubblesHelp(scene) {
  const b = scene.spawn(scene.player.x - 50, scene.player.y - 90, 'bubbles', { role: 'npc', gravity: false, body: false });
  scene.every(16, () => {
    b.x += (scene.player.x - 60 * scene.player.facing - b.x) * 0.06;
    b.y += (scene.player.y - 90 + Math.sin(scene.clock / 300) * 12 - b.y) * 0.06;
    b.face(scene.boss.x - b.x);
  });
  scene.every(900, () => scene.boss.alive && scene.shoot(b, scene.boss, { key: 'shot', role: 'hero', speed: 700 }));
}
