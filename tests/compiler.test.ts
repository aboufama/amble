import { describe, expect, it } from 'vitest';
import { serializeBlocks } from '../src/compiler/serialize';
import { buildUserPrompt, classNames, systemPrompt } from '../src/compiler/prompt';
import { encodeWav, renderSynth, SOUND_PRESETS, SAMPLE_RATE } from '../src/audio/synth';
import { parseJsonReply } from '../src/compiler/openai';
import { cleanRecipe } from '../src/compiler/assets';
import { buildRunPackage } from '../src/player/package';
import { COMPILE_SCHEMA } from '../src/compiler/schema';
import type { Project } from '../src/project/types';

const blocks = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'ev_start',
        x: 10,
        y: 10,
        next: {
          block: {
            type: 'va_set',
            fields: { VARIABLE: 'score', VALUE: '0' },
            next: {
              block: {
                type: 'co_forever',
                inputs: {
                  SUBSTACK: {
                    block: {
                      type: 'co_if_else',
                      fields: { CONDITION: 'I touch a coin' },
                      inputs: {
                        SUBSTACK: { block: { type: 'va_change', fields: { VARIABLE: 'score', AMOUNT: '1' } } },
                        SUBSTACK2: { block: { type: 'mo_move', fields: { HOW: 'toward\nthe mouse' } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      { type: 'ga_rule', fields: { RULE: 'the player has 3 lives' } },
      { type: 'lo_say', fields: { TEXT: 'loose' } },
      { type: 'ev_click', icons: { comment: { text: 'hello' } }, enabled: false },
    ],
  },
  workspaceComments: [{ text: 'Make it fast' }],
};

function project(): Project {
  const img = (name: string) => ({
    id: name,
    name,
    kind: 'image' as const,
    dataUrl: 'data:image/svg+xml;base64,AAAA',
    mime: 'image/svg+xml',
    width: 40,
    height: 40,
    resolution: 1,
    centerX: 20,
    centerY: 20,
  });
  return {
    format: 'amble',
    version: 1,
    id: 'p',
    title: 'Coin Dash',
    notes: 'Collect coins',
    mode: '2d',
    stage: { id: 'stage', kind: 'stage', name: 'Stage', description: '', costumes: [img('backdrop1')], sounds: [], currentCostume: 0, blocks: null },
    sprites: [
      {
        id: 'p1',
        kind: 'sprite',
        name: 'Sprite 1',
        description: 'the hero',
        costumes: [img('hero')],
        sounds: [],
        currentCostume: 0,
        blocks,
        x: 0,
        y: -100,
        z: 0,
        size: 100,
        direction: 0,
        visible: true,
        rotationStyle: 'left-right',
      },
    ],
    compiled: {
      createdAt: 0,
      model: 'm',
      mode: '2d',
      inputHash: 'x',
      summary: '',
      howToPlay: '',
      warnings: [],
      code: [{ targetId: 'p1', targetName: 'Sprite 1', className: 'Sprite1', source: 'class Sprite1 extends Sprite {}', runSource: 'class Sprite1 extends Sprite {}' }],
      sprites: [{ id: 'c1', name: 'Coin', description: 'a coin', x: 10, y: 20, z: 0, size: 100, direction: 0, visible: true, rotationStyle: 'all around' }],
      assets: [{ ...img('coin'), targetId: 'c1', targetName: 'Coin', request: 'gold coin' }],
    },
  };
}

describe('serializeBlocks', () => {
  it('renders scripts, nesting, rules, loose blocks and notes', () => {
    const { text, scripts } = serializeBlocks(blocks);
    expect(scripts).toBe(1);
    expect(text).toBe(
      [
        'Script 1:',
        '  when green flag clicked',
        '    set [score] to [0]',
        '    forever',
        '      if [I touch a coin] then',
        '        change [score] by [1]',
        '      else',
        '        move [toward / the mouse]',
        'Rule: [the player has 3 lives]',
        'Loose blocks (not under a "when" block, so they never run on their own; treat them as hints):',
        '  say [loose]',
        'Note from the author: Make it fast',
      ].join('\n'),
    );
  });

  it('handles empty workspaces', () => {
    expect(serializeBlocks(null).text).toBe('');
  });
});

describe('prompts', () => {
  it('gives every target a unique, safe class name', () => {
    const p = project();
    p.sprites.push({ ...p.sprites[0], id: 'p2', name: 'sprite-1' });
    p.sprites.push({ ...p.sprites[0], id: 'p3', name: 'Sprite' });
    const names = classNames(p);
    expect(names.get('stage')).toBe('StageScript');
    expect(names.get('p1')).toBe('Sprite1');
    expect(names.get('p2')).toBe('Sprite12');
    expect(names.get('p3')).toBe('SpriteScript');
    expect(names.get('c1')).toBe('Coin');
  });

  it('describes the project for the compiler', () => {
    const p = project();
    const text = buildUserPrompt(p, classNames(p));
    expect(text).toContain('Game title: Coin Dash');
    expect(text).toContain('## Sprite "Sprite 1" - class name: Sprite1');
    expect(text).toContain('Costumes (made by the author): "hero" (40x40 px); current: "hero"');
    expect(text).toContain('when green flag clicked');
    expect(text).toContain('target "Coin" costume "coin" 40x40: gold coin');
  });

  it('switches the API section by world mode', () => {
    expect(systemPrompt('2d')).toContain('# 2D world');
    expect(systemPrompt('3d')).toContain('# 3D world');
    expect(systemPrompt('3d')).not.toContain('# 2D world');
  });

  it('uses a strict schema', () => {
    const check = (schema: Record<string, unknown>) => {
      if (schema.type === 'object') {
        const props = Object.keys(schema.properties as object);
        expect(schema.additionalProperties).toBe(false);
        expect([...(schema.required as string[])].sort()).toEqual(props.sort());
        for (const p of Object.values(schema.properties as object)) check(p as Record<string, unknown>);
      }
      if (schema.type === 'array') check(schema.items as Record<string, unknown>);
    };
    check(COMPILE_SCHEMA as unknown as Record<string, unknown>);
  });
});

describe('synth', () => {
  it('renders presets to bounded samples and valid WAV', () => {
    for (const [name, recipe] of Object.entries(SOUND_PRESETS)) {
      const samples = renderSynth(recipe);
      expect(samples.length, name).toBeGreaterThan(SAMPLE_RATE * 0.05);
      expect(Math.max(...samples.map(Math.abs)), name).toBeLessThanOrEqual(0.91);
      const wav = encodeWav(samples);
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
      expect(wav.length).toBe(44 + samples.length * 2);
    }
  });

  it('survives bad input', () => {
    const s = renderSynth({ segments: [{ wave: 'noise', startFreq: -5, endFreq: NaN, duration: 99, startVolume: 3, endVolume: -1 }] });
    expect(s.length).toBe(8 * SAMPLE_RATE);
    expect(s.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('misc', () => {
  it('parses JSON replies with fences', () => {
    expect(parseJsonReply<{ a: number }>('```json\n{"a": 1}\n```').a).toBe(1);
    expect(parseJsonReply<{ a: number }>('Here you go: {"a": 2}').a).toBe(2);
  });

  it('cleans model recipes', () => {
    const r = cleanRecipe({ parts: [{ shape: 'blob', size: [-2], position: 'x', color: 'red', opacity: 9 }] });
    expect(r.parts[0]).toEqual({
      shape: 'box',
      size: [2, 1, 1],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: '#cccccc',
      roughness: 0.7,
      metalness: 0,
      emissive: 0,
      opacity: 1,
    });
    expect(cleanRecipe({}).parts).toHaveLength(1);
  });

  it('builds a run package with compiled code, sprites and assets', () => {
    const pkg = buildRunPackage(project());
    expect(pkg.targets.map((t) => t.name)).toEqual(['Stage', 'Sprite 1', 'Coin']);
    const hero = pkg.targets[1];
    expect(hero.className).toBe('Sprite1');
    expect(hero.costumes.map((c) => c.name)).toEqual(['hero']);
    const coin = pkg.targets[2];
    expect(coin.costumes.map((c) => c.name)).toEqual(['coin']);
    expect(coin.layerOrder).toBe(2);
  });

  it('ignores compiled code when the world mode changed', () => {
    const p = project();
    p.mode = '3d';
    const pkg = buildRunPackage(p);
    expect(pkg.targets.map((t) => t.name)).toEqual(['Stage', 'Sprite 1']);
    expect(pkg.targets[1].code).toBeNull();
  });
});
