// A typical AI mistake: update() uses this.enemy, which create() never made.
class Game extends Amble.Scene {
  static config = { physics: 'arcade', gravity: 1200, background: '#16213e' };
  create() {
    this.level(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '##############################', '##############################']);
    this.player = this.spawnHero(200, 300, 'hero').platformer();
    this.ui.hint('Walk right...');
  }
  update() {
    if (this.player.x > 150) {
      this.enemy.x += 2;
    }
  }
}
