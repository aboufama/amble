import { describe, expect, it } from 'vitest';
import { streamedTitle, watchArray } from '../src/compiler/stream';

describe('watchArray', () => {
  const reply = JSON.stringify({
    title: 'Cluck "Down"',
    howToPlay: 'say "assets": [ no ] here',
    assets: [
      { target: 'Hen', name: 'hen', description: 'a hen with [brackets] and {braces} and \\"quotes\\"' },
      { target: 'Stage', name: 'music', description: 'music: funky' },
    ],
    sprites: [{ name: 'Hen', code: 'class Hen extends Sprite { start() { const assets = []; } }' }],
  });

  it('reports the array once it is complete, however the text arrives', () => {
    for (const step of [1, 7, 64, reply.length]) {
      const seen: unknown[][] = [];
      const feed = watchArray('assets', (items) => seen.push(items));
      for (let n = step; n < reply.length + step; n += step) feed(reply.slice(0, n));
      expect(seen).toEqual([JSON.parse(reply).assets]);
    }
  });

  it('waits until the array has closed', () => {
    const seen: unknown[][] = [];
    const feed = watchArray('assets', (items) => seen.push(items));
    feed(reply.slice(0, reply.indexOf('"sprites"') - 3));
    expect(seen).toEqual([]);
  });

  it('ignores a key of the same name deeper in the reply', () => {
    const seen: unknown[][] = [];
    const feed = watchArray('assets', (items) => seen.push(items));
    feed(JSON.stringify({ sprites: [{ assets: [1] }], assets: [2] }));
    expect(seen).toEqual([[2]]);
  });
});

describe('streamedTitle', () => {
  it('reads the title from the start of the reply', () => {
    expect(streamedTitle('{"title":"Cluck \\"Down\\"","howTo')).toBe('Cluck "Down"');
    expect(streamedTitle('{"assets":[')).toBe('');
  });
});

describe('watchReply', () => {
  it('reports each field when it is complete, and each item of an array as soon as that item is', async () => {
    const { watchReply } = await import('../src/compiler/stream');
    const reply = { title: 'Hen "Run"', plan: 'a\nb', n: 3, ok: true, cast: [{ name: 'Hen', tags: ['a', 'b'] }, { name: 'Dash', x: [1, { y: 2 }] }], sounds: ['x', 'y'], empty: [], last: { a: [1] } };
    const text = JSON.stringify(reply, null, 1);
    const events: string[] = [];
    const feed = watchReply({ onField: (k, v) => events.push(`field ${k} ${JSON.stringify(v)}`), onItem: (k, v, i) => events.push(`item ${k}[${i}] ${JSON.stringify(v)}`) });
    // In small pieces, as a stream comes.
    for (let i = 1; i <= text.length; i += 7) feed(text.slice(0, i));
    feed(text);
    expect(events).toEqual([
      'field title "Hen \\"Run\\""',
      'field plan "a\\nb"',
      'field n 3',
      'field ok true',
      'item cast[0] {"name":"Hen","tags":["a","b"]}',
      'item cast[1] {"name":"Dash","x":[1,{"y":2}]}',
      `field cast ${JSON.stringify(reply.cast)}`,
      'item sounds[0] "x"',
      'item sounds[1] "y"',
      'field sounds ["x","y"]',
      'field empty []',
      'field last {"a":[1]}',
    ]);
  });
});
