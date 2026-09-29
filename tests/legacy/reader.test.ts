import { describe, expect, it } from 'vitest';
import { LEGACY_AUTOSAVE_KEY, isLegacyProject, legacyImportFrom, readLegacyAutosave } from '../../src/legacy/reader';
import type { LegacyCostumeAsset, LegacyImageAsset, LegacyProject, LegacySoundAsset, LegacySpriteTarget } from '../../src/legacy/types';

const png = (tag: string) => `data:image/png;base64,iVBORw0KGgo${tag}`;
const svg = (tag: string) => `data:image/svg+xml;base64,PHN2Zz4${tag}`;
const wav = (tag: string) => `data:audio/wav;base64,UklGR${tag}`;

function image(name: string, dataUrl: string, extra: Partial<LegacyImageAsset> = {}): LegacyImageAsset {
  const mime = dataUrl.startsWith('data:') ? dataUrl.slice(5, dataUrl.search(/[;,]/)) : 'image/png';
  return { id: `a-${name}`, name, kind: 'image', dataUrl, mime, width: 96, height: 106, resolution: 2, centerX: 48, centerY: 58, ...extra };
}

function sound(name: string, dataUrl: string, duration = 0.5): LegacySoundAsset {
  return { id: `a-${name}`, name, kind: 'sound', dataUrl, mime: 'audio/wav', duration };
}

function sprite(name: string, costumes: LegacyCostumeAsset[], sounds: LegacySoundAsset[] = []): LegacySpriteTarget {
  return {
    id: `t-${name}`,
    kind: 'sprite',
    name,
    description: '',
    costumes,
    sounds,
    currentCostume: 0,
    blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'ev_start' }] } },
    x: 0,
    y: 0,
    z: 0,
    size: 100,
    direction: 0,
    visible: true,
    rotationStyle: 'left-right',
  };
}

/** An old autosave: a painted cat, a duplicated coin, a 3D rocket, two backdrops and art the AI made. */
function oldProject(): LegacyProject {
  return {
    format: 'amble',
    version: 1,
    id: 'p-1',
    title: 'Cat Quest',
    notes: 'A cat collects coins before the night falls.',
    mode: '2d',
    stage: {
      id: 't-stage',
      kind: 'stage',
      name: 'Stage',
      description: '',
      costumes: [
        image('backdrop1', svg('white'), { width: 480, height: 360, resolution: 1, centerX: 240, centerY: 180 }),
        image('night sky', png('sky'), { width: 960, height: 720, centerX: 480, centerY: 360 }),
      ],
      sounds: [sound('music', wav('music'), 12)],
      currentCostume: 0,
      blocks: null,
    },
    sprites: [
      sprite('Cat', [image('cat walk', png('cat1')), image('cat jump', png('cat2'), { centerX: 10, centerY: 90 })], [sound('meow', wav('meow'), 0.8)]),
      sprite('Coin', [image('coin', png('coin'))], [sound('pop', wav('pop'))]),
      sprite('Coin2', [image('coin', png('coin'))], [sound('pop', wav('pop'))]),
      sprite('Rocket', [{ id: 'a-rocket', name: 'rocket', kind: 'model', dataUrl: 'data:model/gltf-binary;base64,Z2xURg' }]),
    ],
    variables: ['score'],
    compiled: { assets: [{ ...image('boss', png('boss')), targetId: 'c1', targetName: 'Boss', request: 'a scary boss' }], code: [], sprites: [] },
  };
}

describe('the old project reader', () => {
  it('recognizes old projects the way the old editor did', () => {
    expect(isLegacyProject(oldProject())).toBe(true);
    expect(isLegacyProject({ ...oldProject(), mode: '3d' })).toBe(true);
    const notProjects: unknown[] = [
      null,
      undefined,
      'amble',
      42,
      {},
      { format: 'amble' },
      { ...oldProject(), format: 'scratch' },
      { ...oldProject(), mode: '4d' },
      { ...oldProject(), sprites: {} },
      { ...oldProject(), stage: null },
      { format: 'amble', version: 2, art: {}, sounds: {} },
    ];
    for (const value of notProjects) {
      expect(isLegacyProject(value)).toBe(false);
      expect(legacyImportFrom(value)).toBeNull();
    }
  });

  it('brings the drawings along with their names, owners and pivots, sprites first', () => {
    const { title, notes, drawings } = legacyImportFrom(oldProject())!;
    expect(title).toBe('Cat Quest');
    expect(notes).toBe('A cat collects coins before the night falls.');
    expect(drawings.map((d) => [d.owner, d.name, d.backdrop])).toEqual([
      ['Cat', 'cat walk', false],
      ['Cat', 'cat jump', false],
      ['Coin', 'coin', false],
      ['Stage', 'backdrop1', true],
      ['Stage', 'night sky', true],
    ]);
    expect(drawings[1]).toEqual({
      id: 'a-cat jump',
      name: 'cat jump',
      owner: 'Cat',
      backdrop: false,
      dataUrl: png('cat2'),
      mime: 'image/png',
      width: 96,
      height: 106,
      resolution: 2,
      centerX: 10,
      centerY: 90,
    });
    expect(drawings[3]).toMatchObject({ mime: 'image/svg+xml', width: 480, height: 360, resolution: 1, centerX: 240, centerY: 180 });
  });

  it('brings the sounds along, once each', () => {
    const { sounds } = legacyImportFrom(oldProject())!;
    expect(sounds.map((s) => [s.owner, s.name, s.duration, s.mime])).toEqual([
      ['Cat', 'meow', 0.8, 'audio/wav'],
      ['Coin', 'pop', 0.5, 'audio/wav'],
      ['Stage', 'music', 12, 'audio/wav'],
    ]);
  });

  it('leaves the blocks, the 3D models and the art the AI made behind', () => {
    const result = legacyImportFrom(oldProject())!;
    expect(Object.keys(result).sort()).toEqual(['drawings', 'notes', 'sounds', 'title']);
    const urls = [...result.drawings, ...result.sounds].map((asset) => asset.dataUrl);
    expect(urls).not.toContain(png('boss'));
    expect(urls.filter((url) => url.startsWith('data:model/'))).toEqual([]);
    expect(result.drawings.filter((d) => d.owner === 'Rocket')).toEqual([]);
  });

  it('takes only data: URLs, so bringing a project in never reaches the network', () => {
    const p = oldProject();
    p.sprites[0].costumes.push(
      image('remote', 'https://example.com/cat.png'),
      image('script', 'javascript:alert(1)'),
      image('page', 'data:text/html,<script>alert(1)</script>'),
    );
    p.sprites[0].sounds.push(sound('remote', 'https://example.com/meow.wav'));
    const result = legacyImportFrom(p)!;
    expect(result.drawings).toHaveLength(5);
    expect(result.sounds).toHaveLength(3);
    expect(result.drawings.every((d) => d.dataUrl.startsWith('data:image/'))).toBe(true);
    expect(result.sounds.every((s) => s.dataUrl.startsWith('data:'))).toBe(true);
  });

  it('fills in what a damaged save is missing, and skips what it cannot read', () => {
    const damaged: Record<string, unknown> = {
      ...oldProject(),
      title: 42,
      notes: null,
      stage: { kind: 'stage', costumes: 'none' },
      sprites: [
        null,
        'Cat',
        { name: 7, costumes: undefined, sounds: [null, { kind: 'sound', dataUrl: wav('beep') }] },
        { name: 'Dog', costumes: [{ kind: 'image', dataUrl: png('dog'), width: -3, height: Number.NaN, resolution: 0 }] },
      ],
    };
    const result = legacyImportFrom(damaged)!;
    expect(result.title).toBe('Untitled game');
    expect(result.notes).toBe('');
    expect(result.drawings).toEqual([
      { id: 'drawing-1', name: 'drawing', owner: 'Dog', backdrop: false, dataUrl: png('dog'), mime: 'image/png', width: 0, height: 0, resolution: 1, centerX: 0, centerY: 0 },
    ]);
    expect(result.sounds).toEqual([{ id: 'sound-1', name: 'sound', owner: 'Unnamed', dataUrl: wav('beep'), mime: 'audio/wav', duration: 0 }]);
  });

  it("reads the old editor's autosave key", async () => {
    const keys: string[] = [];
    const result = await readLegacyAutosave(async (key) => {
      keys.push(key);
      return oldProject();
    });
    expect(keys).toEqual(['amble:project']);
    expect(LEGACY_AUTOSAVE_KEY).toBe('amble:project');
    expect(result?.title).toBe('Cat Quest');
    expect(result?.drawings).toHaveLength(5);
    expect(result?.sounds).toHaveLength(3);
  });

  it('gives null when there is no old save, or it cannot be read', async () => {
    expect(await readLegacyAutosave(async () => undefined)).toBeNull();
    expect(await readLegacyAutosave(async () => ({ format: 'amble', version: 2 }))).toBeNull();
    expect(
      await readLegacyAutosave(async () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }),
    ).toBeNull();
    // Node has no IndexedDB at all.
    expect(await readLegacyAutosave()).toBeNull();
  });
});
