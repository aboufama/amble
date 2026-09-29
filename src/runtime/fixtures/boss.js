// MOON KING: run, double-jump, dash and blast a giant boss through three phases of bullet patterns.
class Game extends Amble.Scene {
  static config = { title: 'MOON KING', subtitle: 'Run, jump, dash and blast!', physics: 'arcade', gravity: 1500, background: '#120a2a', controls: { fire: 'BLAST' } };
  static art = {
    hero: { kind: 'character', rig: 'biped', w: 38, h: 64, role: 'hero', name: 'Pip', ask: 'Draw your hero', priority: 1 },
    boss: { kind: 'character', rig: 'blob', w: 220, h: 190, role: 'boss', name: 'Moon King', ask: 'Draw the Moon King, a giant grumpy boss', priority: 2 },
    minion: { kind: 'character', rig: 'blob', w: 46, h: 40, role: 'enemy', name: 'Grumble', ask: 'Draw a little moon minion' },
    ground: { kind: 'terrain', color: '#4a3b7a', top: '#8f7fd6', required: false },
    ledge: { kind: 'terrain', color: '#5b4a91', top: '#b3a4ff', required: false },
    shot: { kind: 'projectile', w: 26, h: 10, color: '#9ff3ff', required: false },
    orb: { kind: 'projectile', w: 18, h: 18, role: 'enemyShot', color: '#ff5ea8', required: false },
    bomb: { kind: 'projectile', w: 30, h: 30, role: 'enemyShot', color: '#ffb347', required: false },
  };
  static dials = {
    jump: { label: 'Jump power', value: 720, min: 400, max: 1100, step: 10, words: 'hop bounce float', for: 'hero' },
    orbSpeed: { label: 'Orb speed', value: 280, min: 120, max: 480, step: 10, for: 'boss' },
    bossHealth: { label: 'Boss health', value: 150, min: 40, max: 400, step: 10, live: false, for: 'boss' },
  };

  create() {
    this.parallax([
      { draw: 'stars', factor: 0.02, speed: 8 },
      { draw: 'mountains', color: '#2a1a55', factor: 0.1, y: 250, height: 290 },
      { draw: 'hills', color: '#3b2574', factor: 0.25, y: 360, height: 180 },
    ]);
    this.level([
      '', '', '', '', '', '', '',
      '            ======            ',
      '', '', '',
      '   ======            ======   ',
      '', '', '',
      '##############################',
      '##############################',
    ], { tile: 32, legend: { '#': 'ground', '=': { key: 'ledge', oneWay: true, height: 16 } } });

    this.player = this.spawnHero(140, 420, 'hero', { hp: 5 })
      .platformer({ speed: 330, jump: () => this.dials.jump, jumps: 2, dash: true })
      .shooter({ key: 'shot', every: 110, aim: '8way', speed: 980 });
    this.ui.hearts(this.player);

    this.boss = this.spawnEnemy(720, 190, 'boss', { boss: true, hp: this.dials.bossHealth });
    this.boss.lookAt(this.player);
    this.ui.bossBar(this.boss, 'THE MOON KING');
    this.music.play('boss');
    this.ui.hint('ARROWS move - SPACE jumps (twice!) - X shoots (hold UP to aim) - SHIFT dashes');

    this.rage = 0;
    const orb = () => this.dials.orbSpeed;
    this.brain(this.boss, {
      fan: { time: 2100, next: 'ring', enter: (b) => this.volley(b, 4, () => this.pattern.spread(b, this.angleTo(b, this.player), { key: 'orb', count: 5 + this.rage * 2, arc: 70, speed: orb })) },
      ring: { time: 2000, next: 'bombs', enter: (b) => this.volley(b, 3, () => this.pattern.ring(b, { key: 'orb', count: 14 + this.rage * 6, speed: () => orb() * 0.7, petals: this.rage ? 3 : 0 })) },
      bombs: { time: 2300, next: 'spiral', enter: (b) => this.volley(b, 3 + this.rage, () => this.dropBomb(b)) },
      spiral: { time: 3000, next: ['fan', 'laser'], enter: (b) => this.pattern.spiral(b, { key: 'orb', arms: 3 + this.rage, turn: 14, every: 110, duration: 2600, speed: () => orb() * 0.65 }) },
      laser: { time: 3000, next: 'fan', enter: (b) => this.pattern.laser(b, 150, { sweep: -45, warn: 800, duration: 1700 }) },
    }, 'fan');

    this.phases(this.boss, [
      { at: 1 },
      { at: 0.66, name: 'PHASE 2', sub: 'Minions incoming!', enter: () => {
        this.rage = 1;
        this.every(3200, () => this.boss.alive && this.spawnMinion());
      } },
      { at: 0.33, name: 'FINAL PHASE', sub: 'The Moon King is FURIOUS', enter: () => {
        this.rage = 2;
        this.boss.play('rage', { lock: true });
        this.cameras.main.setBackgroundColor('#2c0a22');
        this.weather('embers', { amount: 2 });
      } },
    ]);
    this.boss.on('die', () => this.win('MOON KING DEFEATED!'));
  }

  volley(from, times, fire) {
    for (let i = 0; i < times; i++) {
      this.after(i * 380, () => {
        if (!from.alive) return;
        from.play('attack');
        fire();
      });
    }
  }

  dropBomb(boss) {
    this.shoot(boss, this.rand(200, 340), {
      key: 'bomb', speed: this.rand(260, 440), gravity: 900, bounce: 0.65, life: 1700, spin: 400,
      onExpire: (bomb) => {
        this.fx.explode(bomb.x, bomb.y, { size: 0.9 });
        this.pattern.ring(bomb, { key: 'orb', count: 10, speed: 230 });
      },
    });
  }

  spawnMinion() {
    const m = this.spawnEnemy(this.rand(260, 820), -30, 'minion', { hp: 3 });
    m.chase(this.player, 150);
    this.fx.burst(m.x, 10, { colors: ['#ff5d73', '#ffffff'], count: 12, speed: [60, 200], angle: [30, 150] });
  }

  update() {
    const b = this.boss;
    if (!b.alive) return;
    const t = this.clock / 1000;
    const speed = 1 + this.rage * 0.35;
    b.setPosition(700 + Math.sin(t * 0.8 * speed) * 150, 190 + Math.sin(t * 1.7 * speed) * 45 - this.rage * 15);
  }
}
