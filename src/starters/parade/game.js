// PARADE: everyone you drew walks the lit path under the lantern, one after another, with their name.
class Game extends Amble.Scene {
  static config = { title: 'PARADE', subtitle: 'Everyone you drew, on the lit path!', physics: 'none', background: '#141237' };

  static art = {
    hero: { kind: 'character', rig: 'biped', role: 'hero', w: 48, h: 80, facing: 'right', name: 'Star of the parade', ask: 'Draw someone for the parade', priority: 1 },
    pal1: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 1', ask: 'Draw someone to walk in the parade', spare: true },
    pal2: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 2', ask: 'Draw someone to walk in the parade', spare: true },
    pal3: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 3', ask: 'Draw someone to walk in the parade', spare: true },
    pal4: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 4', ask: 'Draw someone to walk in the parade', spare: true },
    pal5: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 5', ask: 'Draw someone to walk in the parade', spare: true },
    pal6: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 6', ask: 'Draw someone to walk in the parade', spare: true },
    pal7: { kind: 'character', rig: 'biped', role: 'npc', w: 48, h: 80, facing: 'right', name: 'Walker 7', ask: 'Draw someone to walk in the parade', spare: true },
  };

  static dials = {
    pace: { label: 'Walking speed', value: 150, min: 60, max: 400, step: 10, words: 'fast slow walk' },
  };

  create() {
    // A drawn sky (any drawing whose name starts with "sky") becomes the night behind the path.
    const keys = this.textures.getTextureKeys().filter((k) => this.hasArt(k));
    const sky = keys.find((k) => k.startsWith('sky'));
    this.parallax(sky ? [{ key: sky, y: 0, height: 540, factor: 0 }] : [{ draw: 'stars' }, { draw: 'hills', color: '#2b2466', y: 300, height: 240 }]);
    // Everyone drawn walks; with nobody drawn yet, the star of the parade walks as just bones.
    this.walkers = keys.filter((k) => k !== sky);
    if (!this.walkers.length) this.walkers = ['hero'];
    // The lit path glows, and the lantern's light flickers in the middle of it.
    this.add.particles(0, 478, 'amble-fx', { frame: 'dot', x: { min: 0, max: 960 }, y: { min: -8, max: 8 }, lifespan: 2400, scale: { start: 1.4, end: 0.2 }, alpha: { start: 0.22, end: 0 }, tint: 0xffc15e, blendMode: 'ADD', frequency: 30 });
    this.add.particles(480, 420, 'amble-fx', { frame: 'dot', lifespan: 900, scale: { start: 6, end: 9 }, alpha: { start: 0.12, end: 0 }, tint: 0xffe7a8, blendMode: 'ADD', frequency: 120 });
    this.weather('embers', { amount: 0.4 });
    this.next = 0;
    this.every(2400, () => this.walkOn());
    this.walkOn();
    this.music.play('chill');
  }

  // The next walker crosses the path; under the lantern it says its name.
  walkOn() {
    const key = this.walkers[this.next % this.walkers.length];
    this.next++;
    const w = this.spawn(-80, 452, key, { role: 'npc', body: false });
    w.play('walk');
    const time = (1120 / this.dials.pace) * 1000;
    this.tweens.add({ targets: w, x: 1040, duration: time, onComplete: () => w.destroy() });
    this.after(time * 0.5, () => {
      if (!w.active) return;
      this.ui.say(w, key === 'hero' ? 'The star of the parade!' : key.replace(/([A-Z0-9]+)/g, ' $1').replace(/^./, (c) => c.toUpperCase()), 1600);
      w.play('wave', { once: true });
    });
  }
}
