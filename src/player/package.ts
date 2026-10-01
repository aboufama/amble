import type { CompiledAsset, CostumeAsset, Project, SoundAsset, SpriteTarget } from '../project/types';
import type { RunCostume, RunPackage, RunSound, RunTarget } from './protocol';

function toRunCostume(c: CostumeAsset | CompiledAsset): RunCostume | null {
  if (c.kind === 'image') {
    return {
      name: c.name,
      kind: 'image',
      url: c.dataUrl,
      isVector: c.mime.includes('svg'),
      resolution: c.resolution || 1,
      centerX: c.centerX,
      centerY: c.centerY,
      width: c.width,
      height: c.height,
    };
  }
  return null;
}

function toRunSound(s: SoundAsset | CompiledAsset): RunSound | null {
  return s.kind === 'sound' ? { name: s.name, url: s.dataUrl } : null;
}

/**
 * Everything the player needs to run the game: the author's sprites and assets as they are now,
 * plus compiled code, compiled sprites and compiled assets from the last build.
 */
export function buildRunPackage(project: Project): RunPackage {
  const compiled = project.compiled;
  const assetsFor = (targetId: string) => (compiled?.assets ?? []).filter((a) => a.targetId === targetId);
  const codeFor = (targetId: string) => compiled?.code.find((c) => c.targetId === targetId) ?? null;

  const costumesOf = (own: CostumeAsset[], id: string) =>
    [...own, ...assetsFor(id).filter((a) => a.kind !== 'sound')]
      .map(toRunCostume)
      .filter((c): c is RunCostume => c !== null);
  const soundsOf = (own: SoundAsset[], id: string) =>
    [...own, ...assetsFor(id).filter((a) => a.kind === 'sound')].map(toRunSound).filter((s): s is RunSound => s !== null);

  const stageCode = codeFor(project.stage.id);
  const stage: RunTarget = {
    kind: 'stage',
    name: project.stage.name,
    className: stageCode?.className ?? null,
    code: stageCode?.runSource ?? null,
    costumes: costumesOf(project.stage.costumes, project.stage.id),
    sounds: soundsOf(project.stage.sounds, project.stage.id),
    costumeNumber: project.stage.currentCostume + 1,
    x: 0,
    y: 0,
    z: 0,
    size: 100,
    direction: 0,
    visible: true,
    rotationStyle: 'all around',
    layerOrder: 0,
  };

  const sprite = (s: SpriteTarget | (Omit<SpriteTarget, 'costumes' | 'sounds' | 'blocks' | 'currentCostume' | 'kind' | 'z'> & { costumes: CostumeAsset[]; sounds: SoundAsset[]; currentCostume: number }), layer: number): RunTarget => {
    const code = codeFor(s.id);
    return {
      kind: 'sprite',
      name: s.name,
      className: code?.className ?? null,
      code: code?.runSource ?? null,
      costumes: costumesOf(s.costumes, s.id),
      sounds: soundsOf(s.sounds, s.id),
      costumeNumber: s.currentCostume + 1,
      x: s.x,
      y: s.y,
      z: 0,
      size: s.size,
      direction: s.direction,
      visible: s.visible,
      rotationStyle: s.rotationStyle,
      layerOrder: layer,
    };
  };

  const targets: RunTarget[] = [stage];
  project.sprites.forEach((s, i) => targets.push(sprite(s, i + 1)));
  const userNames = new Set(project.sprites.map((s) => s.name));
  (compiled?.sprites ?? [])
    .filter((s) => !userNames.has(s.name))
    .forEach((s, i) => targets.push(sprite({ ...s, costumes: [], sounds: [], currentCostume: 0 }, project.sprites.length + i + 1)));

  return { mode: '2d', title: project.title, targets };
}

/**
 * A cheap fingerprint of everything that affects the run package (not blocks or descriptions),
 * so the stage preview only reloads when what you'd see actually changed.
 */
export function packageKey(project: Project): string {
  const asset = (a: { id: string; name: string; kind: string } & Record<string, unknown>) =>
    [a.id, a.name, a.kind, typeof a.dataUrl === 'string' ? `${(a.dataUrl as string).length}${(a.dataUrl as string).slice(-24)}` : 0, a.centerX ?? '', a.centerY ?? ''].join(':');
  const target = (t: Project['stage'] | Project['sprites'][number]) =>
    [
      t.id,
      t.name,
      t.currentCostume,
      t.kind === 'sprite' ? [t.x, t.y, t.size, t.direction, t.visible, t.rotationStyle].join(',') : '',
      t.costumes.map((c) => asset(c as never)).join('|'),
      t.sounds.map((c) => asset(c as never)).join('|'),
    ].join(';');
  const c = project.compiled;
  return [
    project.title,
    target(project.stage),
    ...project.sprites.map(target),
    c ? [c.createdAt, c.code.map((x) => x.targetId + x.runSource.length).join(','), c.sprites.map((x) => x.id).join(','), c.assets.map((x) => asset(x as never)).join('|')].join('#') : 'none',
  ].join('\n');
}
