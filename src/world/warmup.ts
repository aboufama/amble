/**
 * The Warm-up game (§2.5; M2 owns): while a plan's build runs, the world plays a small valid kit game that
 * lines the plan's cast up on a lit ground, idling (drawn members animated, the rest just bones), under
 * the world's title. A working minimal version.
 */
import type { CodeFile, PlanCastItem, PlanReply } from '../model/types';
import { sizeOf } from '../pipeline/sizes';

/**
 * The plan's relative sizes in game px (§5.4), by the pipeline's one table: characters scale the 40x64 hero
 * unit, things without bones are square on the hero's width, terrain is one 32 px tile, a background fills
 * the screen. The build is told these same sizes, so the Warm-up's request notes match the built game's.
 */
export function planSize(item: Pick<PlanCastItem, 'size'> & Partial<Pick<PlanCastItem, 'kind'>>): { w: number; h: number } {
  return sizeOf(item.size, item.kind ?? 'character');
}

/** Members that stand in the line-up (not scenery or shots). */
function standsInLine(c: PlanCastItem): boolean {
  return c.kind === 'character' || c.kind === 'item' || c.kind === 'prop';
}

export function warmupCode(plan: PlanReply): CodeFile[] {
  const art = plan.cast
    .map((c, i) => {
      const { w, h } = planSize(c);
      const spec = { kind: c.kind, rig: c.rig, role: c.role, w, h, facing: c.facing, name: c.name, ask: c.ask, about: c.about, pronoun: c.pronoun, priority: i + 1, required: c.required };
      const fields = Object.entries(spec)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      return `    ${c.key}: { ${fields} },`;
    })
    .join('\n');
  const line = plan.cast.filter(standsInLine).map((c) => c.key);
  const source = `// Warm-up: the cast waits on a lit path while Amble builds the world.
class Game extends Amble.Scene {
  static config = { title: ${JSON.stringify(plan.title)}, subtitle: 'Warming up', physics: 'arcade', gravity: 0, background: '#151843' };
  static art = {
${art}
  };

  create() {
    this.parallax([{ draw: 'stars', factor: 0, speed: 6 }]);
    this.platform(0, 470, 960, 70);
    const line = ${JSON.stringify(line)};
    const gap = 960 / (line.length + 1);
    // Everyone stands in a row and idles: drawn members move, the rest are just bones.
    line.forEach((key, i) => {
      const actor = this.spawn(gap * (i + 1), 470, key, { gravity: false, immovable: true });
      actor.play('idle');
    });
    this.ui.text(480, 80, ${JSON.stringify(plan.title)}, { size: 40, originX: 0.5 });
  }
}
`;
  return [{ path: 'game.js', source, authors: [['starter', source.split('\n').length]], locked: [] }];
}
