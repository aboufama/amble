/** Counts of what a running game holds (objects, particles, bodies, shots, tweens, textures). */
import Phaser from 'phaser';
import type { AmbleScene } from './scene';

export interface GameCounts {
  objects: number;
  particles: number;
  arcadeBodies: number;
  matterBodies: number;
  shots: number;
  tweens: number;
  textureMB: number;
}

function walk(list: Phaser.GameObjects.GameObject[], out: { objects: number; particles: number }): void {
  for (const o of list) {
    out.objects++;
    if (o instanceof Phaser.GameObjects.Particles.ParticleEmitter) out.particles += o.getAliveParticleCount();
    if (o instanceof Phaser.GameObjects.Container) walk(o.list, out);
  }
}

/** Decoded texture memory in MB (width x height x 4 per source image). */
function textureMB(game: Phaser.Game): number {
  let bytes = 0;
  const list = (game.textures as unknown as { list: Record<string, Phaser.Textures.Texture> }).list;
  for (const tex of Object.values(list)) {
    for (const src of tex.source) bytes += (src.width || 0) * (src.height || 0) * 4;
  }
  return Math.round((bytes / 1048576) * 10) / 10;
}

export function countGame(game: Phaser.Game): GameCounts {
  const out = { objects: 0, particles: 0, arcadeBodies: 0, matterBodies: 0, shots: 0, tweens: 0, textureMB: 0 };
  for (const scene of game.scene.getScenes(true)) {
    const counts = { objects: 0, particles: 0 };
    walk(scene.children.list, counts);
    out.objects += counts.objects;
    out.particles += counts.particles;
    const arcade = scene.physics?.world;
    if (arcade) out.arcadeBodies += arcade.bodies.size + arcade.staticBodies.size;
    const matter = scene.matter?.world;
    if (matter) out.matterBodies += matter.getAllBodies().length;
    out.tweens += scene.tweens.getTweens().length;
    const k = (scene as Partial<AmbleScene>).__kit;
    if (k) {
      for (const name of k.pools) {
        const g = k.groups.get(name);
        if (g) out.shots += g.countActive(true);
      }
    }
  }
  out.textureMB = textureMB(game);
  return out;
}
