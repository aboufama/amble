// MOON KING: run, double-jump, dash and blast a giant grumpy moon through three phases.
class Game extends Amble.Scene {
  static config = {
    title: 'MOON KING', subtitle: 'Beat the grumpy moon in three phases!', physics: 'arcade', gravity: 1500,
    background: '#0d0b26', controls: { jump: 'JUMP', fire: 'FIRE', dash: 'DASH' },
  };

  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 40, h: 64, facing: 'right', name: 'Pip', ask: 'Draw your hero', about: 'Runs, jumps twice, dashes and shoots star shots.', pronoun: 'them', priority: 1 },
    moonKing: { kind: 'character', rig: 'blob', role: 'boss', w: 200, h: 224, facing: 'left', name: 'The Moon King', ask: 'Draw the Moon King, a giant grumpy boss', about: 'He fights in three phases and gets furious at the end.', pronoun: 'him', priority: 2 },
    grumble: { kind: 'character', rig: 'blob', role: 'enemy', w: 46, h: 40, name: 'Grumble', ask: 'Draw a Grumble, a little moon minion', about: 'They hop down from the sky in phase 2.', pronoun: 'them', priority: 3 },
    star: { kind: 'item', role: 'item', shape: 'star', w: 30, h: 30, name: 'Star shard', ask: 'Draw a star shard', about: 'Grab one for super shots.', priority: 4 },
    sky: { kind: 'background', role: 'background', w: 960, h: 540, name: 'Moon sky', ask: 'Draw the sky over the moon', required: false, priority: 5 },
    bubbles: { kind: 'character', rig: 'flyer', role: 'npc', w: 44, h: 40, facing: 'right', name: 'Bubbles', ask: 'Draw Bubbles, a flying friend who helps you', spare: true },
    ledge: { kind: 'terrain', w: 32, h: 16, color: '#3b2f78', top: '#86f3cb', name: 'Moon rock', required: false },
    shot: { kind: 'projectile', w: 22, h: 10, color: '#9ff3ff', name: 'Star shot', required: false },
    orb: { kind: 'projectile', role: 'enemyShot', w: 18, h: 18, color: '#ff6fae', name: 'Moon orb', required: false },
  };

  static dials = {
    jump: { label: 'Jump height', value: 720, min: 450, max: 1100, step: 10, words: 'hop high float', for: 'hero' },
    hearts: { label: 'Hearts', value: 5, min: 1, max: 9, step: 1, live: false, words: 'lives health', for: 'hero' },
    health: { label: 'Health', value: 160, min: 40, max: 400, step: 10, live: false, words: 'hp strong', for: 'moonKing' },
    orbSpeed: { label: 'Orb speed', value: 260, min: 120, max: 480, step: 10, words: 'bullets fast', for: 'moonKing' },
    angry: { label: 'Angry at', value: 33, min: 5, max: 95, step: 1, unit: '%', words: 'rage furious mad', for: 'moonKing' },
    gravity: { label: 'Gravity', value: 100, min: 30, max: 200, step: 5, unit: '%', words: 'heavy floaty' },
  };

  create() {
    // The sky: your drawing, or the game's own stars and hills until you draw one.
    this.makeSky();
    const floor = this.add.zone(480, FLOOR + 30, 960, 60);
    this.physics.add.existing(floor, true);
    this.group('platforms').add(floor);
    for (const [x, y] of [[190, 370], [420, 280], [740, 380]]) this.platform(x, y, 160, 16, 'ledge', { oneWay: true });

    const hearts = this.dials.hearts;
    this.player = this.spawnHero(140, 440, 'hero', { hp: hearts })
      .platformer({ speed: 330, jump: () => this.dials.jump, jumps: 2, dash: true })
      .shooter({ key: 'shot', every: 120, speed: 1000, aim: '8way', count: () => this.power, damage: () => this.power });
    this.ui.hearts(this.player);
    this.power = 1;
    this.glow = this.fx.halo(this.player, 0xffd23f, 2.2).setAlpha(0);

    const health = this.dials.health;
    this.boss = this.spawnBoss(720, 240, 'moonKing', { hp: health });
    this.boss.lookAt(this.player);
    this.ui.bossBar(this.boss, 'THE MOON KING');
    this.boss.on('drawn', () => this.roar());
    this.boss.on('die', () => this.win('MOON KING DEFEATED!'));
    this.music.play('boss');
    this.ui.hint('ARROWS move  ·  SPACE jumps twice  ·  X shoots (hold UP to aim)  ·  SHIFT dashes', 7000);

    // The boss's brain: each attack lasts a while, then the next one starts.
    this.rage = 0;
    this.slamming = false;
    this.gravityWas = 100;
    const orb = () => this.dials.orbSpeed * (this.furious ? 1.3 : 1);
    this.brain(this.boss, {
      fan: { time: 2200, next: 'ring', enter: (b) => volley(this, b, 3, () => this.pattern.spread(b, this.angleTo(b, this.player), { key: 'orb', count: 5 + this.rage * 2, arc: 70, speed: orb })) },
      ring: { time: 2000, next: 'spiral', enter: (b) => volley(this, b, 3, () => this.pattern.ring(b, { key: 'orb', count: 14 + this.rage * 5, speed: () => orb() * 0.75, petals: this.rage ? 3 : 0 })) },
      spiral: { time: 3000, next: ['laser', 'slam', 'fan'], enter: (b) => this.pattern.spiral(b, { key: 'orb', arms: 3 + this.rage, turn: this.furious ? 19 : 13, every: 110, duration: 2600, speed: () => orb() * 0.7 }) },
      laser: { time: 3000, next: 'fan', enter: (b, brain) => (this.rage ? this.pattern.laser(b, this.angleTo(b, this.player) - 40, { sweep: 80, warn: 800, duration: 1600 }) : brain.go('fan')) },
      slam: { time: 3200, next: 'fan', enter: (b, brain) => (this.furious ? slam(this, b, this.player) : brain.go('ring')) },
    }, 'fan');

    // Phase 2 starts at two thirds of his health: Grumbles join the fight.
    this.phases(this.boss, [
      { at: 1 },
      { at: 0.66, name: 'PHASE 2', sub: 'Grumbles incoming!', enter: () => {
        this.rage = 1;
        grumbleWave(this, 3);
        this.every(6500, () => this.boss.alive && grumbleWave(this, 2 + this.rage));
      } },
    ]);
    this.every(7000, () => this.all('items').length === 0 && dropStar(this));
    if (this.hasArt('bubbles')) bubblesHelp(this);
  }

  makeSky() {
    this.sky?.forEach((layer) => layer.destroy());
    this.drawnSky = this.hasArt('sky');
    this.sky = this.drawnSky
      ? this.parallax([{ key: 'sky', y: 0, height: 540, factor: 0 }])
      : this.parallax([{ draw: 'stars', factor: 0.02 }, { draw: 'mountains', color: '#241a55', y: 250, height: 290 }, { draw: 'hills', color: '#8c80d8', y: 400, height: 140 }]);
    if (this.furious) this.sky.forEach((layer) => layer.setTint(0xff8f8f));
  }

  roar() {
    this.sfx('roar');
    this.fx.shake(0.02, 400);
    this.ui.say(this.boss, 'RAAAH!', 1400);
  }

  // FINAL PHASE: the sky turns red, embers fly, every attack gets faster and he starts to slam.
  enrage() {
    this.furious = true;
    this.rage = 2;
    this.ui.big('FINAL PHASE', { sub: 'The Moon King is FURIOUS!', color: '#ff5d73' });
    this.fx.flash('#ff3355', 250, 0.5);
    this.fx.chroma(0.03, 900);
    this.fx.shockwave(this.boss.x, this.boss.y, { radius: 420, color: 0xff5d73 });
    this.sky.forEach((layer) => layer.setTint(0xff8f8f));
    this.cameras.main.setBackgroundColor('#3a0b1e');
    this.weather('embers', { amount: 2 });
    this.music.intensity(2);
    this.boss.play('rage');
    this.roar();
  }

  update() {
    const b = this.boss;
    // The Gravity dial scales the world's gravity (twists like Moon gravity still work on top).
    if (this.dials.gravity !== this.gravityWas) {
      this.physics.world.gravity.y *= this.dials.gravity / this.gravityWas;
      this.gravityWas = this.dials.gravity;
    }
    if (this.hasArt('sky') !== this.drawnSky) this.makeSky();
    if (!b.alive) return;
    if (!this.furious && b.hp <= (b.maxHp * this.dials.angry) / 100) this.enrage();
    if (this.slamming) return;
    // He floats in a lazy figure eight, faster when he is angry.
    const t = this.clock / 1000;
    const speed = 1 + this.rage * 0.35;
    b.setPosition(720 + Math.sin(t * 0.8 * speed) * 120, 240 + Math.sin(t * 1.6 * speed) * 35);
  }
}
