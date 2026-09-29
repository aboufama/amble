// CLANK'S CLIMB: climb the tower before the goo gets you. Double-jump, stomp Spikies, and reach the rocket!
class Game extends Amble.Scene {
  static config = {
    title: "CLANK'S CLIMB", subtitle: 'Climb to the rocket before the goo gets you!', physics: 'arcade', gravity: 1500,
    background: '#1b1640', controls: { jump: 'JUMP' },
  };

  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 38, h: 64, facing: 'right', name: 'Clank', ask: 'Draw your hero, maybe a robot', about: 'Runs, jumps twice in the air, and stomps Spikies.', pronoun: 'them', priority: 1 },
    spiky: { kind: 'character', rig: 'quadruped', role: 'enemy', w: 50, h: 36, facing: 'right', name: 'Spiky', ask: 'Draw a Spiky, a prickly critter', about: 'They pace along the girders. Stomp them!', pronoun: 'them', priority: 2 },
    gear: { kind: 'item', role: 'item', shape: 'coin', w: 30, h: 30, name: 'Gear', ask: 'Draw a shiny gear', about: 'Grab them on the way up.', priority: 3 },
    rocket: { kind: 'prop', role: 'prop', w: 64, h: 128, name: 'Rocket', ask: 'Draw the rocket at the top of the tower', about: 'Reach it and blast off!', priority: 4 },
    goo: { kind: 'terrain', role: 'hazard', w: 256, h: 128, color: '#8fdc45', top: '#d4f98a', name: 'Goo', ask: 'Draw the rising goo', about: 'It creeps up the tower. Do not touch it!', priority: 5 },
    buddy: { kind: 'character', rig: 'biped', role: 'npc', w: 36, h: 56, facing: 'left', name: 'Buddy bot', ask: 'Draw Buddy, a robot friend', spare: true },
    girder: { kind: 'terrain', w: 32, h: 16, color: '#5a4e8c', top: '#ffb347', name: 'Girder', required: false },
  };

  static dials = {
    jump: { label: 'Jump height', value: 720, min: 450, max: 1100, step: 10, words: 'hop high float', for: 'hero' },
    jumps: { label: 'Double jumps', value: 2, min: 1, max: 5, step: 1, words: 'air jumps triple', for: 'hero' },
    gooSpeed: { label: 'Goo speed', value: 38, min: 0, max: 150, step: 2, unit: 'px', words: 'goo lava rise faster', for: 'goo' },
    spikySpeed: { label: 'Spiky speed', value: 70, min: 0, max: 220, step: 5, words: 'enemies fast', for: 'spiky' },
  };

  create() {
    this.city = this.parallax([{ draw: 'stars', factor: 0 }, { draw: 'city', color: '#2a2358', y: 300, height: 240, factor: 0 }])[1];
    const tower = buildTower(this);
    this.rocket = tower.rocket;
    this.gooY = TOWER_H - 45;
    this.goo = makeGoo(this);
    this.launched = false;
    this.meters = -1;
    this.player = this.spawnHero(480, TOWER_H - 80, 'hero', { hp: 3 })
      .platformer({ speed: 300, jump: () => this.dials.jump, jumps: () => this.dials.jumps, coyoteMs: 110, bufferMs: 140 });
    this.follow(this.player, { lerp: 0.15, lerpY: 0.1, deadzone: [120, 80] });
    this.ui.hearts(this.player);
    this.heightText = this.ui.text(480, 26, '', { size: 26 });
    this.music.play('adventure');
    this.ui.hint('ARROWS run  ·  SPACE jumps (again in the air!)  ·  land on Spikies to stomp them');
    this.overlap(this.player, this.rocket, () => !this.launched && blastOff(this));
    // Buddy (once drawn) waits halfway up and fixes you up with a heart.
    if (this.hasArt('buddy') && tower.buddySpot) {
      const buddy = this.spawn(tower.buddySpot.x, tower.buddySpot.y, 'buddy', { role: 'npc' });
      this.overlap(this.player, buddy, () => {
        if (!this.cooldown('buddy', 60000)) return;
        this.player.heal(1);
        buddy.play('cheer');
        this.ui.say(buddy, 'Here, a spare heart!');
      });
    }
    this.player.on('stomp', (e) => this.combo.hit(e.x, e.y));
  }

  update(time, delta) {
    const p = this.player;
    // The city sinks below you as you climb.
    this.city.setY(300 + (TOWER_H - 540 - this.cameras.main.scrollY) * 0.12);
    if (this.launched) return;
    riseGoo(this, delta / 1000);
    // The goo stings: touching it costs a heart.
    if (p.alive && p.y + 24 > this.gooY + 30) gooBurn(this, p);
    const meters = Math.max(0, Math.round((TOWER_H - 80 - p.y) / 40));
    if (meters !== this.meters) {
      this.meters = meters;
      this.heightText.setText(`${meters} m`);
    }
  }
}
