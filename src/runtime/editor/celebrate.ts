/**
 * After Bring to life: the new drawing cheers. Characters with arms wave (the kit's `cheer` move);
 * everything else does a quick hop (a squash and a stretch of its picture, never its body, so the game's
 * physics are untouched). The editor draws the mint sparks around it (§2.17).
 */
import Phaser from 'phaser';
import { Character } from '../kit/character';
import { env } from '../kit/env';
import { collectObjects } from './objects';

const CHEER_MS = 1100;
const HOP_MS = 400;

function hop(c: Character): void {
  const scene = c.scene;
  const s = c.squashScale;
  if (env().prefs.reducedMotion) return;
  scene.tweens.chain({
    targets: s,
    tweens: [
      { x: 1.12, y: 0.86, duration: HOP_MS * 0.2, ease: 'Sine.easeOut' },
      { x: 0.9, y: 1.16, duration: HOP_MS * 0.35, ease: 'Sine.easeOut' },
      { x: 1, y: 1, duration: HOP_MS * 0.45, ease: 'Back.easeOut' },
    ],
  });
}

/** Plays the celebration on every live character with this key (the first few, at least). */
export function celebrate(game: Phaser.Game, key: string): number {
  const found = collectObjects(game, 512).filter((f) => f.item.key === key && f.obj instanceof Character);
  let n = 0;
  for (const f of found.slice(0, 6)) {
    const c = f.obj as Character;
    if (!c.active || !c.alive) continue;
    n++;
    if (c.spec.rig === 'biped') {
      c.play('cheer', { lock: true });
      window.setTimeout(() => {
        if (c.active) c.play('idle');
      }, CHEER_MS);
    } else {
      c.play('jump', { once: true });
      hop(c);
    }
  }
  return n;
}
