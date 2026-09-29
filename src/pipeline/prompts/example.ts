/**
 * The example game in the build prompt (§5.3 `{{EXAMPLE_MOON_KING_CORE}}`): a complete, valid game.js
 * in the style Amble wants: plain statics, live dials, telegraphed attacks, escalation, juice, and every
 * picture declared as art. tests/pipeline/prompts.test.ts validates it against the kit.
 */
export const EXAMPLE_GAME = `// MOON KING: dodge the Moon King's star storms, grab star shards to go giant, and blast him through three phases.
class Game extends Amble.Scene {
  static config = { title: 'MOON KING', subtitle: 'Jump, dash and blast!', physics: 'arcade', gravity: 1500, background: '#151843', controls: { fire: 'BLAST' } };
  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 40, h: 64, facing: 'right', name: 'Pip', ask: 'Draw Pip, your hero', about: 'Runs, jumps and blasts.', pronoun: 'them', priority: 1, required: true },
    moonKing: { kind: 'character', rig: 'blob', role: 'boss', w: 200, h: 180, facing: 'left', name: 'The Moon King', ask: 'Draw the Moon King, a giant grumpy boss', about: 'Three phases of star storms.', pronoun: 'him', priority: 2, required: true },
    grumble: { kind: 'character', rig: 'blob', role: 'enemy', w: 46, h: 40, facing: 'left', name: 'Grumble', ask: 'Draw a Grumble, a grumpy moon rock', about: 'They chase you in phase 2.', pronoun: 'them', priority: 3, required: true },
    shard: { kind: 'item', role: 'item', shape: 'star', w: 30, h: 30, name: 'Star shard', ask: 'Draw a star shard', about: 'Grab it to go giant.', pronoun: 'it', priority: 4, required: false },
    shot: { kind: 'projectile', role: 'projectile', w: 26, h: 12, name: 'Star shot', ask: 'Draw your star shot', pronoun: 'it', priority: 5, required: false },
    orb: { kind: 'projectile', role: 'enemyShot', w: 18, h: 18, name: 'Moon orb', ask: 'Draw a moon orb', pronoun: 'it', priority: 6, required: false },
    ground: { kind: 'terrain', role: 'terrain', w: 32, h: 32, name: 'Moon ground', ask: 'Draw the moon ground', pronoun: 'it', priority: 7, required: false },
  };
  static dials = {
    jump: { label: 'Jump power', value: 720, min: 400, max: 1100, step: 10, words: 'hop bounce float', for: 'hero' },
    orbSpeed: { label: 'Orb speed', value: 260, min: 120, max: 480, step: 10, words: 'bullets fast slow', for: 'moonKing' },
    bossHp: { label: 'Moon King health', value: 150, min: 40, max: 400, step: 10, live: false, words: 'boss health life', for: 'moonKing' },
  };

  create() {
    this.parallax([{ draw: 'stars', factor: 0.02, speed: 8 }, { draw: 'hills', color: '#2a2e6e', factor: 0.25, y: 380, height: 160 }]);
    // '#' is solid ground; '=' is a thin ledge you can jump up through.
    this.level([
      '', '', '', '', '', '', '',
      '            ======            ',
      '', '', '',
      '   ======            ======   ',
      '', '', '',
      '##############################',
      '##############################',
    ], { tile: 32, legend: { '=': { key: 'ground', oneWay: true, height: 16 } } });

    // The hero: jump power is a live dial; hold fire for a stream of star shots.
    this.spawnHero(140, 420, 'hero', { hp: 5 })
      .platformer({ speed: 330, jump: () => this.dials.jump, jumps: 2, dash: true })
      .shooter({ key: 'shot', every: 120, speed: 950, aim: '8way' });
    this.ui.hearts(this.hero);

    this.boss = this.spawnBoss(720, 190, 'moonKing', { hp: this.dials.bossHp });
    this.boss.lookAt(this.hero);
    this.ui.bossBar(this.boss, 'THE MOON KING');
    this.music.play('boss');
    this.ui.hint('ARROWS move - SPACE jumps twice - X blasts - SHIFT dashes');
    this.rage = 0;

    // The boss's brain: a telegraphed fan, then a ring, then a spiral, round and round.
    const orb = () => this.dials.orbSpeed;
    this.brain(this.boss, {
      fan: { time: 2200, next: 'ring', enter: (b) => this.windUp(b, () => this.pattern.spread(b, this.angleTo(b, this.hero), { key: 'orb', count: 5 + this.rage * 2, arc: 70, speed: orb })) },
      ring: { time: 2000, next: 'spiral', enter: (b) => this.windUp(b, () => this.pattern.ring(b, { key: 'orb', count: 14 + this.rage * 6, speed: () => orb() * 0.7 })) },
      spiral: { time: 3000, next: 'fan', enter: (b) => this.pattern.spiral(b, { key: 'orb', arms: 3 + this.rage, turn: 14, every: 110, duration: 2600, speed: () => orb() * 0.6 }) },
    }, 'fan');

    // Escalation: each phase is angrier (the kit shows the big title and shakes the screen).
    this.phases(this.boss, [
      { at: 1 },
      { at: 0.66, name: 'PHASE 2', sub: 'Grumbles incoming!', enter: () => {
        this.rage = 1;
        this.every(3000, () => this.spawnGrumble());
      } },
      { at: 0.33, name: 'FINAL PHASE', sub: 'The Moon King is FURIOUS', enter: () => {
        this.rage = 2;
        this.boss.play('rage', { lock: true });
        this.music.intensity(2);
        this.weather('embers', { amount: 2 });
      } },
    ]);

    // The twist: now and then a star shard falls; grab it to go giant and smash everything.
    this.every(9000, () => this.spawnItem(this.rand(120, 840), 150, 'shard', { float: 10, onPickup: (hero) => this.goGiant(hero) }));

    // The kit plays the boss's huge explosion; then we win with our own words.
    this.boss.on('die', () => this.win('MOON KING DEFEATED!'));
  }

  windUp(boss, attack) {
    // Fair play: a flash ring warns you, then the attack comes.
    boss.play('attack');
    this.fx.shockwave(boss.x, boss.y, { radius: 140, color: '#ffd23f' });
    this.after(450, () => boss.alive && attack());
  }

  spawnGrumble() {
    if (!this.boss.alive || this.all('enemies').length > 6) return;
    const x = this.hero.x < 480 ? 900 : 60; // never on top of the player
    this.spawnEnemy(x, 380, 'grumble', { hp: 3 }).chase(this.hero, 150);
  }

  goGiant(hero) {
    hero.smash = true;
    hero.setScale(1.8);
    this.fx.punch(0.12);
    this.fx.slowmo(0.4, 600);
    this.ui.big('GIANT MODE!', { color: '#ffd23f' });
    this.after(5000, () => {
      hero.smash = false;
      hero.setScale(1);
    });
  }

  update() {
    // The Moon King floats in a figure eight that speeds up as he gets angrier.
    const b = this.boss;
    if (!b.alive) return;
    const t = this.clock / 1000;
    const s = 1 + this.rage * 0.35;
    b.setPosition(700 + Math.sin(t * 0.8 * s) * 150, 190 + Math.sin(t * 1.7 * s) * 45);
  }
}
`;
