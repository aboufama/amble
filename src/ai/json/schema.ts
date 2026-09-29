/**
 * A small JSON Schema toolkit for model replies: a typed builder (`s.object(...)`) that produces
 * strict Structured Outputs schemas, a runtime checker for the same subset, and helpers to clamp
 * over-long values and to strip the keywords that only the local checker understands.
 *
 * Strict mode needs every property listed in `required` and `additionalProperties: false`; the
 * builder always does both, so optional fields are written as `s.nullable(...)`. Length, count and
 * range limits are checked here and removed from the schema that goes on the wire, because not
 * every OpenAI-compatible strict mode accepts them.
 */

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSchema {
  type?: JsonType | JsonType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  const?: JsonPrimitive;
  anyOf?: JsonSchema[];
  /** Local-only keywords: checked by `checkJson`, removed by `wireSchema`. */
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

const LOCAL_ONLY = ['minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems'] as const;

declare const typeTag: unique symbol;

/** A JSON Schema that also carries the TypeScript type of the values it accepts. */
export interface Schema<T> {
  readonly json: JsonSchema;
  readonly [typeTag]?: T;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

function schema<T>(json: JsonSchema): Schema<T> {
  return { json };
}

function limits(o: { min?: number; max?: number }, lo: 'minLength' | 'minimum' | 'minItems', hi: 'maxLength' | 'maximum' | 'maxItems'): JsonSchema {
  const out: JsonSchema = {};
  if (o.min !== undefined) out[lo] = o.min;
  if (o.max !== undefined) out[hi] = o.max;
  return out;
}

interface Described {
  description?: string;
}

/** Builders for strict schemas. `s.object` makes every property required and forbids extras. */
export const s = {
  string(o: Described & { min?: number; max?: number; pattern?: string } = {}): Schema<string> {
    return schema({ type: 'string', ...describe(o), ...limits(o, 'minLength', 'maxLength'), ...(o.pattern ? { pattern: o.pattern } : {}) });
  },
  number(o: Described & { min?: number; max?: number } = {}): Schema<number> {
    return schema({ type: 'number', ...describe(o), ...limits(o, 'minimum', 'maximum') });
  },
  integer(o: Described & { min?: number; max?: number } = {}): Schema<number> {
    return schema({ type: 'integer', ...describe(o), ...limits(o, 'minimum', 'maximum') });
  },
  boolean(o: Described = {}): Schema<boolean> {
    return schema({ type: 'boolean', ...describe(o) });
  },
  enum<const T extends readonly string[]>(values: T, o: Described = {}): Schema<T[number]> {
    return schema({ type: 'string', enum: [...values], ...describe(o) });
  },
  array<T>(items: Schema<T>, o: Described & { min?: number; max?: number } = {}): Schema<T[]> {
    return schema({ type: 'array', items: items.json, ...describe(o), ...limits(o, 'minItems', 'maxItems') });
  },
  object<P extends Record<string, Schema<unknown>>>(props: P, o: Described = {}): Schema<{ [K in keyof P]: Infer<P[K]> }> {
    const properties: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(props)) properties[k] = v.json;
    return schema({ type: 'object', ...describe(o), properties, required: Object.keys(props), additionalProperties: false });
  },
  nullable<T>(inner: Schema<T>): Schema<T | null> {
    return schema({ anyOf: [inner.json, { type: 'null' }] });
  },
  /** Wraps a hand-written JSON Schema. The caller vouches that `T` matches it. */
  raw<T>(json: JsonSchema): Schema<T> {
    return schema(json);
  },
};

function describe(o: Described): JsonSchema {
  return o.description ? { description: o.description } : {};
}

function typeOf(value: unknown): JsonType | 'undefined' | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return Number.isFinite(value) ? (Number.isInteger(value) ? 'integer' : 'number') : 'other';
    case 'object':
      return 'object';
    case 'undefined':
      return 'undefined';
    default:
      return 'other';
  }
}

function typeMatches(actual: ReturnType<typeof typeOf>, expected: JsonType): boolean {
  return actual === expected || (expected === 'number' && actual === 'integer');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeOf(value) === 'object';
}

/** Where a problem is, like `$.cast[2].ask`. */
function at(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * Checks a value against a schema. Returns readable problems (at most `max`), empty when it fits.
 * The messages are written so they can be sent back to the model in a repair round.
 */
export function checkJson(value: unknown, json: JsonSchema, path = '$', max = 20): string[] {
  const out: string[] = [];
  visit(value, json, path, out, max);
  return out;
}

function visit(value: unknown, json: JsonSchema, path: string, out: string[], max: number): void {
  if (out.length >= max) return;
  if (json.anyOf) {
    const tries = json.anyOf.map((branch) => checkJson(value, branch, path, max));
    if (tries.some((t) => t.length === 0)) return;
    // Report the branch whose type fits (so `null`-or-object reports the object's problems).
    const fitting = json.anyOf.findIndex((b) => !b.type || typesOf(b).some((t) => typeMatches(typeOf(value), t)));
    out.push(...tries[fitting >= 0 ? fitting : 0].slice(0, max - out.length));
    return;
  }
  const actual = typeOf(value);
  if (json.type) {
    const expected = typesOf(json);
    if (!expected.some((t) => typeMatches(actual, t))) {
      out.push(`${path}: expected ${expected.map(article).join(' or ')}, got ${actual === 'undefined' ? 'nothing' : article(actual)}`);
      return;
    }
  }
  if (json.const !== undefined && value !== json.const) out.push(`${path}: must be ${JSON.stringify(json.const)}`);
  if (json.enum && !json.enum.includes(value as JsonPrimitive)) out.push(`${path}: must be one of ${json.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    if (json.minLength !== undefined && value.length < json.minLength) out.push(`${path}: shorter than ${json.minLength} characters`);
    if (json.maxLength !== undefined && value.length > json.maxLength) out.push(`${path}: longer than ${json.maxLength} characters`);
    if (json.pattern !== undefined && !new RegExp(json.pattern).test(value)) out.push(`${path}: doesn't match ${json.pattern}`);
  }
  if (typeof value === 'number') {
    if (json.minimum !== undefined && value < json.minimum) out.push(`${path}: less than ${json.minimum}`);
    if (json.maximum !== undefined && value > json.maximum) out.push(`${path}: more than ${json.maximum}`);
  }
  if (Array.isArray(value)) {
    if (json.minItems !== undefined && value.length < json.minItems) out.push(`${path}: fewer than ${json.minItems} items`);
    if (json.maxItems !== undefined && value.length > json.maxItems) out.push(`${path}: more than ${json.maxItems} items`);
    if (json.items) value.forEach((item, i) => visit(item, json.items as JsonSchema, at(path, i), out, max));
  }
  if (isRecord(value)) {
    for (const key of json.required ?? []) if (!(key in value)) out.push(`${path}: missing "${key}"`);
    if (json.additionalProperties === false && json.properties) {
      for (const key of Object.keys(value)) if (!(key in json.properties)) out.push(`${at(path, key)}: not allowed`);
    }
    for (const [key, sub] of Object.entries(json.properties ?? {})) if (key in value) visit(value[key], sub, at(path, key), out, max);
  }
  if (out.length > max) out.length = max;
}

function typesOf(json: JsonSchema): JsonType[] {
  return json.type === undefined ? [] : Array.isArray(json.type) ? json.type : [json.type];
}

function article(t: string): string {
  if (t === 'null') return 'null';
  return /^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`;
}

/**
 * Trims what a model tends to overdo: strings past `maxLength`, arrays past `maxItems`, numbers
 * outside `minimum`/`maximum`. Returns a new value; everything else is left for `checkJson`.
 */
export function clampJson(value: unknown, json: JsonSchema): unknown {
  if (json.anyOf) {
    const branch = json.anyOf.find((b) => typesOf(b).some((t) => typeMatches(typeOf(value), t)));
    return branch ? clampJson(value, branch) : value;
  }
  if (typeof value === 'string' && json.maxLength !== undefined && value.length > json.maxLength) return value.slice(0, json.maxLength).trimEnd();
  if (typeof value === 'number' && Number.isFinite(value)) {
    let v = value;
    if (json.minimum !== undefined) v = Math.max(v, json.minimum);
    if (json.maximum !== undefined) v = Math.min(v, json.maximum);
    return v;
  }
  if (Array.isArray(value)) {
    const kept = json.maxItems !== undefined ? value.slice(0, json.maxItems) : value;
    return json.items ? kept.map((item) => clampJson(item, json.items as JsonSchema)) : kept;
  }
  if (isRecord(value) && json.properties) {
    const out: Record<string, unknown> = { ...value };
    for (const [key, sub] of Object.entries(json.properties)) if (key in out) out[key] = clampJson(out[key], sub);
    return out;
  }
  return value;
}

/** The schema as sent to the endpoint: the same shape without the local-only keywords. */
export function wireSchema(json: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...json };
  for (const k of LOCAL_ONLY) delete out[k];
  if (json.properties) out.properties = Object.fromEntries(Object.entries(json.properties).map(([k, v]) => [k, wireSchema(v)]));
  if (json.items) out.items = wireSchema(json.items);
  if (json.anyOf) out.anyOf = json.anyOf.map(wireSchema);
  return out;
}

/**
 * Problems that would make a strict Structured Outputs endpoint reject the schema: objects that
 * allow extra properties or don't require every property. Empty for anything `s.object` built.
 */
export function strictSchemaProblems(json: JsonSchema, path = '$'): string[] {
  const out: string[] = [];
  if (typesOf(json).includes('object') || json.properties) {
    if (json.additionalProperties !== false) out.push(`${path}: set additionalProperties to false`);
    const props = Object.keys(json.properties ?? {});
    const required = new Set(json.required ?? []);
    for (const p of props) if (!required.has(p)) out.push(`${path}.${p}: must be required (use nullable for optional fields)`);
  }
  for (const [k, v] of Object.entries(json.properties ?? {})) out.push(...strictSchemaProblems(v, `${path}.${k}`));
  if (json.items) out.push(...strictSchemaProblems(json.items, `${path}[]`));
  json.anyOf?.forEach((b, i) => out.push(...strictSchemaProblems(b, `${path}|${i}`)));
  return out;
}
