// GRAVITY DASH: an endless runner. Jump the gaps, stomp blobs for combos, grab power-ups, flip gravity!
class Game extends Amble.Scene {
  static config = { title: 'GRAVITY DASH', subtitle: 'Run forever. Flip the world.', physics: 'arcade', gravity: 1700, background: '#8fd3ff' };
  static art = {
    hero: { kind: 'character', rig: 'biped', w: 38, h: 64, role: 'hero', name: 'Zip', ask: 'Draw your runner', priority: 1 },
    blob: { kind: 'character', rig: 'blob', w: 50, h: 44, role: 'enemy', name: 'Grumble', ask: 'Draw a grumpy blob' },
    ground: { kind: 'terrain', color: '#8a5a44', top: '#6cc551', required: false },
    coin: { kind: 'item', shape: 'coin', w: 26, h: 26, color: '#ffd23f', required: false },
    magnet: { kind: 'item', w: 42, h: 42, color: '#ff5d73', ask: 'Draw a magnet power-up' },
    mushroom: { kind: 'item', w: 44, h: 44, color: '#ff8c42', ask: 'Draw a giant-mode mushroom' },
    clock: { kind: 'item', w: 42, h: 42, color: '#4cc9f0', ask: 'Draw a slow-time clock' },
    portal: { kind: 'item', shape: 'ellipse', w: 56, h: 120, color: '#c77dff', ask: 'Draw a gravity portal' },
  };
  static dials = {
    speed: { label: 'Run speed', value: 380, min: 200, max: 620, step: 10, words: 'fast quick', for: 'hero' },
    jump: { label: 'Jump power', value: 780, min: 500, max: 1100, step: 10, words: 'hop high', for: 'hero' },
  };

  create() {
    this.sky = this.parallax([
      { draw: 'clouds', color: '#ffffff', factor: 0.05, speed: 14, y: 30, height: 190 },
      { draw: 'mountains', color: '#6d8fc9', factor: 0.12, y: 190, height: 350 },
      { draw: 'hills', color: '#58a36b', factor: 0.3, y: 320, height: 220 },
    ]);
    this.player = this.spawnHero(160, 400, 'hero', { hp: 3 }).runner({ speed: () => this.dials.speed, maxSpeed: 660, jump: () => this.dials.jump, jumps: 2 });
    this.follow(this.player, { lerp: 1, lockY: true, offsetX: -220 });
    this.ui.hearts(this.player);
    this.meters = this.ui.text(480, 28, '0 m', { size: 30 });
    this.coinValue = this.tune('coinValue', 10, { min: 5, max: 50, step: 5, label: 'Coin value' });
    this.music.play('chase');
    this.ui.hint('SPACE jumps (twice in the air!)  -  stomp blobs, grab power-ups, flip gravity!');
    this.add.particles(0, 0, 'amble-fx', {
      frame: 'spark', x: 1000, y: { min: 0, max: 540 }, speedX: { min: -1500, max: -900 }, lifespan: 700,
      frequency: 45, scaleX: 1.4, scaleY: 0.25, alpha: { start: 0.45, end: 0 }, blendMode: 'ADD',
    }).setScrollFactor(0).setDepth(900);

    this.floorX = this.ceilX = -480;
    this.chunks({ start: -480, size: 960, make: (x0, i) => this.makeChunk(x0, i) });
    this.events.on('pickup', (item) => item.key === 'coin' && this.combo.hit());
    this.player.on('stomp', () => this.combo.hit());
  }

  makeChunk(x0, i) {
    const end = x0 + 960;
    while (this.floorX < end) {
      const w = i === 0 ? 1500 : this.rand(260, 520);
      const gap = i === 0 ? 0 : this.rand(110, 150 + Math.min(i, 20) * 3);
      this.platform(this.floorX + w / 2, 520, w, 80, 'ground');
      if (i > 0 && this.chance(0.55)) {
        const left = this.floorX;
        this.spawnEnemy(left + w * 0.6, 440, 'blob', { hp: 1 }).patrol(70, { min: left + 30, max: left + w - 30 });
      }
      if (gap) this.coinArc(this.floorX + w, gap, false);
      this.floorX += w + gap;
    }
    const portal = i > 0 && i % 3 === 1;
    if (portal) this.safeCeiling = x0 + 2400;
    while (this.ceilX < end) {
      const w = this.rand(300, 600);
      const gap = i < 2 || this.ceilX < (this.safeCeiling || 0) ? 0 : this.rand(90, 140);
      this.platform(this.ceilX + w / 2, 20, w, 80, 'ground').setFlipY(true);
      if (gap && this.chance(0.5)) this.coinArc(this.ceilX + w, gap, true);
      this.ceilX += w + gap;
    }
    if (i > 0) {
      const kind = portal ? 'portal' : this.pick(['magnet', 'mushroom', 'clock']);
      this.spawn(x0 + this.rand(250, 700), kind === 'portal' ? 270 : this.gravityFlipped ? 190 : 350, kind, { float: 10, onPickup: () => this.power(kind) });
    }
  }

  coinArc(x, gap, ceiling) {
    for (let k = 0; k < 5; k++) {
      const cx = x - 30 + ((gap + 60) * k) / 4;
      const lift = Math.sin((k / 4) * Math.PI) * 80;
      this.spawn(cx, ceiling ? 130 + lift : 400 - lift, 'coin', { points: this.coinValue });
    }
  }

  power(kind) {
    const p = this.player;
    this.sfx('powerup');
    if (kind === 'portal') {
      this.flipGravity();
      this.cameras.main.setBackgroundColor(this.gravityFlipped ? '#3a1d5c' : '#8fd3ff');
      this.sky.forEach((layer) => layer.setTint(this.gravityFlipped ? 0xc9a0ff : 0xffffff));
      this.ui.big('GRAVITY FLIP!', { color: '#c77dff' });
    } else if (kind === 'magnet') {
      this.magnetUntil = this.clock + 8000;
      this.ui.big('MAGNET!', { color: '#ff5d73' });
    } else if (kind === 'clock') {
      this.fx.slowmo(0.4, 3500);
      this.fx.chroma(0.02, 700);
      this.ui.big('SLOW TIME!', { color: '#4cc9f0' });
    } else if (kind === 'mushroom') {
      p.smash = true;
      this.fx.punch(0.12);
      this.tweens.add({ targets: p, scale: 1.8, duration: 300, ease: 'Back.easeOut' });
      this.ui.big('GIANT MODE!', { color: '#ff8c42' });
      this.after(6000, () => {
        p.smash = false;
        this.tweens.add({ targets: p, scale: 1, duration: 300 });
      });
    }
  }

  update() {
    const p = this.player;
    this.meters.setText(Math.floor(p.x / 40) + ' m');
    if (p.alive && (p.y > 700 || p.y < -160)) {
      p.alive = false;
      this.lose('YOU FELL!');
    }
    if (this.clock < (this.magnetUntil || 0)) {
      for (const coin of this.all('items')) {
        if (coin.key === 'coin' && this.dist(coin, p) < 300) {
          coin.x += (p.x - coin.x) * 0.2;
          coin.y += (p.y - coin.y) * 0.2;
        }
      }
    }
  }
}
