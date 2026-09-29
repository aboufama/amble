// SKY RUN: an endless run over the clouds at dusk. Jump the gaps, stomp Bloops, grab glims, run on the ceiling!
class Game extends Amble.Scene {
  static config = {
    title: 'SKY RUN', subtitle: 'Run forever over the clouds!', physics: 'arcade', gravity: 1700,
    background: '#3b2a6b', controls: { jump: 'JUMP' },
  };

  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 36, h: 64, facing: 'right', name: 'Dash', ask: 'Draw your runner', about: 'Runs by itself. You jump, twice in the air.', pronoun: 'them', priority: 1 },
    bloop: { kind: 'character', rig: 'blob', role: 'enemy', w: 46, h: 40, name: 'Bloop', ask: 'Draw a Bloop, a bouncy cloud blob', about: 'They bounce along the clouds. Stomp them!', pronoun: 'them', priority: 2 },
    glim: { kind: 'item', role: 'item', shape: 'diamond', w: 30, h: 30, name: 'Glim', ask: 'Draw a glim, a shiny gem', about: 'Grab them in a row for a combo. A golden one makes you giant!', priority: 3 },
    portal: { kind: 'prop', role: 'prop', shape: 'ellipse', w: 60, h: 96, name: 'Flip portal', ask: 'Draw a flip portal', about: 'Run through it and the world turns upside down.', priority: 4 },
    sky: { kind: 'background', role: 'background', w: 960, h: 540, name: 'Dusk sky', ask: 'Draw the sky at sunset', required: false, priority: 5 },
    kite: { kind: 'character', rig: 'flyer', role: 'npc', w: 60, h: 50, facing: 'right', name: 'Kite', ask: 'Draw Kite, a friend who can fly', spare: true },
    cloud: { kind: 'terrain', w: 64, h: 40, color: '#f3b3d2', top: '#ffffff', name: 'Cloud', required: false },
  };

  static dials = {
    speed: { label: 'Run speed', value: 360, min: 200, max: 620, step: 10, words: 'fast quick', for: 'hero' },
    jump: { label: 'Jump height', value: 780, min: 500, max: 1100, step: 10, words: 'hop high float', for: 'hero' },
    speedUp: { label: 'Speed-up', value: 6, min: 0, max: 30, step: 1, words: 'faster harder' },
    gap: { label: 'Gap size', value: 100, min: 40, max: 200, step: 5, unit: '%', words: 'holes wide' },
    arcs: { label: 'Glim arcs', value: 5, min: 0, max: 12, step: 1, words: 'gems glims more', for: 'glim' },
  };

  create() {
    this.makeSky();
    this.player = this.spawnHero(160, 420, 'hero', { hp: 3 })
      .runner({ speed: () => this.dials.speed, maxSpeed: 680, speedUp: () => this.dials.speedUp, jump: () => this.dials.jump, jumps: 2 });
    this.follow(this.player, { lerp: 1, lockY: true, offsetX: -240 });
    this.ui.hearts(this.player);
    this.distance = this.ui.text(480, 26, '0 m', { size: 30 });
    this.meters = 0;
    this.music.play('chase');
    this.ui.hint('SPACE jumps (twice in the air!)  ·  stomp Bloops  ·  run through the portal!');
    // Wind streaks make the run feel fast.
    this.add.particles(0, 0, 'amble-fx', {
      frame: 'spark', x: 1000, y: { min: 0, max: 540 }, speedX: { min: -1500, max: -900 }, lifespan: 700,
      frequency: 60, scaleX: 1.4, scaleY: 0.25, alpha: { start: 0.4, end: 0 }, blendMode: 'ADD',
    }).setScrollFactor(0).setDepth(900);

    // The endless world: each chunk is built just before you see it.
    this.floorX = this.ceilX = -480;
    this.safeCeiling = 0;
    this.kiteUsed = false;
    this.chunks({ start: -480, size: 960, make: (x0, i) => makeChunk(this, x0, i) });
    this.events.on('pickup', (item) => item.key === 'glim' && this.combo.hit(item.x, item.y));
    this.player.on('stomp', (e) => this.combo.hit(e.x, e.y));
  }

  // The sky: your drawing, or the game's own clouds and hills until you draw one.
  makeSky() {
    this.sky?.forEach((layer) => layer.destroy());
    this.drawnSky = this.hasArt('sky');
    this.sky = this.drawnSky
      ? this.parallax([{ key: 'sky', y: 0, height: 540, factor: 0.05 }])
      : this.parallax([{ draw: 'stars', factor: 0.02 }, { draw: 'clouds', color: '#f7c1dc', factor: 0.08, y: 60, height: 200 }, { draw: 'hills', color: '#8a5aa8', factor: 0.2, y: 300, height: 240 }]);
    if (this.gravityFlipped) this.sky.forEach((layer) => layer.setTint(0xc9a0ff));
  }

  // Through a portal the world flips upside down, in slow motion.
  flip() {
    this.fx.slowmo(0.35, 700);
    this.flipGravity();
    this.sky.forEach((layer) => layer.setTint(this.gravityFlipped ? 0xc9a0ff : 0xffffff));
    this.ui.big(this.gravityFlipped ? 'UPSIDE DOWN!' : 'RIGHT WAY UP!', { color: '#ff8fd0' });
  }

  // The golden glim: giant mode smashes every Bloop you touch for six seconds.
  giantMode() {
    const p = this.player;
    p.smash = true;
    this.fx.punch(0.12);
    this.fx.shockwave(p.x, p.y, { radius: 260, color: 0xffd23f });
    this.tweens.add({ targets: p, scale: 1.8, duration: 300, ease: 'Back.easeOut' });
    this.ui.big('GIANT MODE!', { color: '#ffd23f' });
    this.music.intensity(2);
    this.after(6000, () => {
      p.smash = false;
      this.tweens.add({ targets: p, scale: 1, duration: 300 });
      this.music.intensity(0);
    });
  }

  update() {
    const p = this.player;
    const m = Math.floor(p.x / 40);
    if (m !== this.meters) {
      this.meters = m;
      this.distance.setText(m + ' m');
    }
    if (this.hasArt('sky') !== this.drawnSky) this.makeSky();
    // Fell into a gap? Kite (if you drew one) saves you once. Otherwise the run is over.
    const fell = this.gravityFlipped ? p.y < -40 : p.y > 590;
    if (!p.alive || !fell) return;
    if (this.hasArt('kite') && !this.kiteUsed) return kiteRescue(this, p);
    p.alive = false;
    this.lose('YOU FELL!');
  }
}
