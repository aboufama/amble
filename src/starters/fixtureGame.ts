/**
 * FOUNDATION-STUB: the fixture game the stub catalog opens for every starter until M8's starter worlds
 * land (adapted from the probe's boss game). When the player core merges, this becomes its demo boss game.
 */
export const FIXTURE_GAME = `// The Moon King: run, double-jump, dash and blast a giant boss through three phases.
class Game extends Amble.Scene {
  static config = { title: 'The Moon King', subtitle: 'Run, jump, dash and blast!', physics: 'arcade', gravity: 1500, background: '#151843' };
  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 40, h: 64, facing: 'right', name: 'Pip', ask: 'Draw your hero', about: 'Your hero. Runs, jumps and shoots.', pronoun: 'them', priority: 1, required: true },
    moonKing: { kind: 'character', rig: 'blob', role: 'boss', w: 200, h: 180, facing: 'left', name: 'The Moon King', ask: 'Draw the Moon King, a giant grumpy boss', about: 'A huge boss with three phases.', pronoun: 'him', priority: 2, required: true },
    grumble: { kind: 'character', rig: 'blob', role: 'enemy', w: 46, h: 40, facing: 'left', name: 'Grumble', ask: 'Draw a Grumble, a little moon rock', about: 'Grumbles chase you in phase 2.', pronoun: 'them', priority: 3, required: true },
    star: { kind: 'item', role: 'item', w: 28, h: 28, name: 'Star shard', ask: 'Draw a star shard', about: 'It makes your shots bigger.', pronoun: 'it', priority: 4, required: false },
    ground: { kind: 'terrain', role: 'terrain', w: 32, h: 32, name: 'Ground', ask: 'Draw the moon ground', about: 'Made by the game until you draw it.', pronoun: 'it', priority: 8, required: false },
    ledge: { kind: 'terrain', role: 'terrain', w: 32, h: 16, name: 'Ledge', ask: 'Draw a floating ledge', about: 'Made by the game until you draw it.', pronoun: 'it', priority: 8, required: false },
    shot: { kind: 'projectile', role: 'projectile', w: 26, h: 10, name: 'Star shot', ask: 'Draw your shot', about: 'What you shoot.', pronoun: 'it', priority: 6, required: false },
    orb: { kind: 'projectile', role: 'enemyShot', w: 18, h: 18, name: 'Moon orb', ask: 'Draw a moon orb', about: 'What the Moon King throws.', pronoun: 'it', priority: 7, required: false },
  };
  static dials = {
    jump: { label: 'Jump height', value: 720, min: 400, max: 1100, step: 20, live: true, words: 'hop bounce float', for: 'hero' },
    bossHp: { label: 'Moon King health', value: 150, min: 50, max: 400, step: 10, live: false, words: 'boss health life', for: 'moonKing' },
    orbSpeed: { label: 'Orb speed', value: 240, min: 120, max: 420, step: 10, live: true, words: 'bullets fast slow', for: 'moonKing' },
  };

  create() {
    this.parallax([{ draw: 'stars', factor: 0.02, speed: 8 }, { draw: 'hills', color: '#2a2e6e', factor: 0.25, y: 380, height: 160 }]);
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
      .platformer({ speed: 330, jump: () => this.dial.jump, jumps: 2, dash: true })
      .shooter({ key: 'shot', every: 110, aim: '8way', speed: 980 });
    this.ui.hearts(this.player);

    this.boss = this.spawnEnemy(720, 190, 'moonKing', { boss: true, hp: this.dial.bossHp });
    this.boss.lookAt(this.player);
    this.ui.bossBar(this.boss, 'THE MOON KING');
    this.rage = 0;

    // The boss's brain: a fan of orbs, then a ring, then a spiral, over and over.
    this.brain(this.boss, {
      fan: { time: 2100, next: 'ring', enter: (b) => this.pattern.spread(b, this.angleTo(b, this.player), { key: 'orb', count: 5 + this.rage * 2, arc: 70, speed: () => this.dial.orbSpeed }) },
      ring: { time: 2000, next: 'spiral', enter: (b) => this.pattern.ring(b, { key: 'orb', count: 14 + this.rage * 6, speed: () => this.dial.orbSpeed }) },
      spiral: { time: 3000, next: 'fan', enter: (b) => this.pattern.spiral(b, { key: 'orb', arms: 3 + this.rage, turn: 14, every: 110, duration: 2600, speed: 180 }) },
    }, 'fan');

    this.phases(this.boss, [
      { at: 1 },
      { at: 0.66, name: 'PHASE 2', sub: 'Grumbles incoming!', enter: () => {
        this.rage = 1;
        this.every(3200, () => this.boss.alive && this.spawnGrumble());
      } },
      { at: 0.33, name: 'FINAL PHASE', sub: 'The Moon King is FURIOUS', enter: () => {
        this.rage = 2;
        this.boss.play('rage', { lock: true });
      } },
    ]);
    this.boss.on('die', () => this.win('MOON KING DEFEATED!'));
  }

  spawnGrumble() {
    const g = this.spawnEnemy(this.rand(260, 820), -30, 'grumble', { hp: 3 });
    g.chase(this.player, 150);
  }

  update() {
    const b = this.boss;
    if (!b.alive) return;
    const t = this.clock / 1000;
    const speed = 1 + this.rage * 0.35;
    b.setPosition(700 + Math.sin(t * 0.8 * speed) * 150, 190 + Math.sin(t * 1.7 * speed) * 45 - this.rage * 15);
  }
}
`;
