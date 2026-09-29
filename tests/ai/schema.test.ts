import { describe, expect, expectTypeOf, it } from 'vitest';
import { parseJsonReply } from '../../src/ai/json/parse';
import { checkJson, clampJson, s, strictSchemaProblems, wireSchema, type Infer, type JsonSchema } from '../../src/ai/json/schema';

const Rig = s.object({
  kind: s.enum(['biped', 'blob', 'object']),
  facing: s.nullable(s.enum(['left', 'right'])),
  joints: s.array(s.object({ name: s.string(), x: s.integer({ min: 0, max: 1000 }), y: s.integer({ min: 0, max: 1000 }) }), { max: 3 }),
  note: s.string({ max: 10 }),
});

describe('schema builder', () => {
  it('infers the TypeScript type of the reply', () => {
    expectTypeOf<Infer<typeof Rig>>().toEqualTypeOf<{
      kind: 'biped' | 'blob' | 'object';
      facing: 'left' | 'right' | null;
      joints: { name: string; x: number; y: number }[];
      note: string;
    }>();
  });

  it('builds strict schemas: every property required, nothing extra', () => {
    expect(strictSchemaProblems(Rig.json)).toEqual([]);
    expect(Rig.json.required).toEqual(['kind', 'facing', 'joints', 'note']);
    const loose: JsonSchema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'number' } }, required: [], additionalProperties: false } }, required: ['a'] };
    expect(strictSchemaProblems(loose)).toEqual(['$: set additionalProperties to false', '$.b: must be required (use nullable for optional fields)', '$.b.c: must be required (use nullable for optional fields)']);
  });

  it('strips local-only limits from the wire schema', () => {
    const wire = JSON.stringify(wireSchema(Rig.json));
    expect(wire).not.toMatch(/maxLength|maxItems|minimum|maximum/);
    expect(wire).toContain('"additionalProperties":false');
    expect(JSON.stringify(Rig.json)).toMatch(/maxItems/);
  });
});

describe('checkJson', () => {
  const good = { kind: 'biped', facing: null, joints: [{ name: 'neck', x: 500, y: 200 }], note: 'ok' };

  it('accepts a matching value', () => {
    expect(checkJson(good, Rig.json)).toEqual([]);
    expect(checkJson({ ...good, facing: 'left' }, Rig.json)).toEqual([]);
  });

  it('reports problems with a path a model can act on', () => {
    expect(checkJson({ ...good, kind: 'dragon', extra: 1, joints: [{ name: 'neck', x: 1.5, y: 2000 }] }, Rig.json)).toEqual([
      '$.extra: not allowed',
      '$.kind: must be one of "biped", "blob", "object"',
      '$.joints[0].x: expected an integer, got a number',
      '$.joints[0].y: more than 1000',
    ]);
    expect(checkJson({ kind: 'blob' }, Rig.json)).toEqual(['$: missing "facing"', '$: missing "joints"', '$: missing "note"']);
    expect(checkJson([], Rig.json)).toEqual(['$: expected an object, got an array']);
    expect(checkJson({ ...good, facing: 'up' }, Rig.json)).toEqual(['$.facing: must be one of "left", "right"']);
  });

  it('caps the number of problems', () => {
    const many = s.array(s.string());
    expect(checkJson(Array.from({ length: 50 }, (_, i) => i), many.json, '$', 5)).toHaveLength(5);
  });
});

describe('clampJson', () => {
  it('trims strings and lists and clamps numbers, leaving the rest', () => {
    const v = clampJson({ kind: 'blob', facing: null, joints: [1, 2, 3, 4].map((i) => ({ name: `j${i}`, x: -5, y: 5000 })), note: 'a very long note' }, Rig.json) as Infer<typeof Rig>;
    expect(v.joints).toHaveLength(3);
    expect(v.joints[0]).toEqual({ name: 'j1', x: 0, y: 1000 });
    expect(v.note).toBe('a very lon');
    expect(checkJson(v, Rig.json)).toEqual([]);
  });
});

describe('parseJsonReply', () => {
  it('reads plain JSON, fenced JSON and JSON wrapped in prose', () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonReply('```json\n{"a": 2}\n```')).toEqual({ ok: true, value: { a: 2 } });
    expect(parseJsonReply('Here you go:\n```\n{"a": 3}\n```\nEnjoy!')).toEqual({ ok: true, value: { a: 3 } });
    expect(parseJsonReply('Sure: {"a": {"b": 4}} hope that helps')).toEqual({ ok: true, value: { a: { b: 4 } } });
    expect(parseJsonReply('﻿ {"a": 5}')).toEqual({ ok: true, value: { a: 5 } });
  });

  it('explains what went wrong', () => {
    expect(parseJsonReply('')).toEqual({ ok: false, error: 'The reply was empty.' });
    const r = parseJsonReply('{"a": 1');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/wasn't valid JSON/);
  });
});
