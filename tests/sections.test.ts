import { describe, expect, it } from 'vitest';
import { LEAN_SCHEMA, leanHeaderSchema, parseSections, sectionsStart, watchSections } from '../src/compiler/lean';
import { AiError, parseJsonReply } from '../src/compiler/openai';

const header = { title: 'Hen Run', howToPlay: 'Arrows', cast: [], backdrops: [], sounds: [], warnings: [], questions: [] };
const reply = `${JSON.stringify(header)}
=== sprite Hen ===
class Hen extends Sprite {
  start() { this.say("hi \\"there\\""); }
}
=== sprite Fox ===
\`\`\`js
class Fox extends Sprite {}
\`\`\`
=== piece p1 ===
const g = this.game;
for (;;) yield;
`;

describe('code as plain text after a JSON header', () => {
  it('reads the header and each section, without fences', () => {
    const r = parseSections(reply, (json) => parseJsonReply(json));
    expect(r.title).toBe('Hen Run');
    expect(r.sprites.map((s) => s.name)).toEqual(['Hen', 'Fox']);
    expect(r.sprites[0].code).toBe('class Hen extends Sprite {\n  start() { this.say("hi \\"there\\""); }\n}');
    expect(r.sprites[1].code).toBe('class Fox extends Sprite {}');
    expect(r.pieces).toEqual([{ id: 'p1', code: 'const g = this.game;\nfor (;;) yield;' }]);
  });

  it('gives a class written as its body alone its class line', () => {
    const r = parseSections(`${JSON.stringify(header)}\n=== sprite Herder ===\nstart() {\n  this.show();\n}\n=== piece p1 ===\nfor (;;) yield;`, (json) => parseJsonReply(json));
    expect(r.sprites[0].code).toBe('class Herder extends Sprite {\nstart() {\n  this.show();\n}\n}');
  });

  it('asks again (as JSON) when there is no code to read', () => {
    expect(() => parseSections(JSON.stringify(header), (json) => parseJsonReply(json))).toThrow(AiError);
    expect(() => parseSections('not json at all', (json) => parseJsonReply(json))).toThrow(AiError);
  });

  it('tells each class as soon as the next section starts, once', () => {
    const told: string[] = [];
    const watch = watchSections((name, code) => told.push(`${name}:${code.length}`));
    const cut = reply.indexOf('=== sprite Fox');
    watch(reply.slice(0, cut - 5));
    expect(told).toEqual([]);
    watch(reply.slice(0, cut + 20));
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/^Hen:/);
    watch(reply);
    watch(reply);
    expect(told.map((t) => t.split(':')[0])).toEqual(['Hen', 'Fox']);
    expect(sectionsStart(reply)).toBe(reply.indexOf('=== sprite Hen'));
  });

  it('asks the header for everything but the code', () => {
    const h = leanHeaderSchema(LEAN_SCHEMA);
    expect(h.required).not.toContain('sprites');
    expect(h.required).not.toContain('pieces');
    expect(Object.keys(h.properties)).toContain('cast');
  });
});
