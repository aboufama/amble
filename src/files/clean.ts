/**
 * Cleaners for data from outside (§4.6): like the guards in src/model/guards.ts, but they return a new,
 * clean value instead of true/false. Unknown fields are dropped, strings are capped at their limit, and
 * anything of the wrong type fails the whole value (`FAIL`). Hand-written, no dependency.
 */

export const FAIL = Symbol('fail');
export type Failed = typeof FAIL;
export type Cleaner<T> = (v: unknown) => T | Failed;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Characters that never belong in text shown to a student (controls, bidi overrides); newlines stay. */
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

/** A string, capped at `max` characters (unsafe control characters removed); shorter than `min` fails. */
export function str(max: number, min = 0): Cleaner<string> {
  return (v) => {
    if (typeof v !== 'string') return FAIL;
    const s = v.replace(UNSAFE_TEXT, '').slice(0, max);
    return s.length < min ? FAIL : s;
  };
}

/** A string that must match exactly (ids, keys, paths): never capped, never changed. */
export function pattern(re: RegExp): Cleaner<string> {
  return (v) => (typeof v === 'string' && re.test(v) ? v : FAIL);
}

export function num(min = -Infinity, max = Infinity): Cleaner<number> {
  return (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : FAIL);
}

export function int(min = -Infinity, max = Infinity): Cleaner<number> {
  return (v) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : FAIL);
}

export const bool: Cleaner<boolean> = (v) => (typeof v === 'boolean' ? v : FAIL);

export function lit<const T extends readonly (string | number | boolean | null)[]>(...values: T): Cleaner<T[number]> {
  return (v) => (values.includes(v as T[number]) ? (v as T[number]) : FAIL);
}

export function oneOf<T extends string>(list: readonly T[]): Cleaner<T> {
  return (v) => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : FAIL);
}

/** Every item must clean; more than `max` items fails. */
export function arr<T>(of: Cleaner<T>, max = Infinity): Cleaner<T[]> {
  return (v) => {
    if (!Array.isArray(v) || v.length > max) return FAIL;
    const out: T[] = [];
    for (const x of v) {
      const c = of(x);
      if (c === FAIL) return FAIL;
      out.push(c);
    }
    return out;
  };
}

/** Items that don't clean are dropped, and the list is cut to `max` (palettes, notes, footstep summaries). */
export function arrLoose<T>(of: Cleaner<T>, max = Infinity): Cleaner<T[]> {
  return (v) => {
    if (!Array.isArray(v)) return FAIL;
    const out: T[] = [];
    for (const x of v) {
      if (out.length >= max) break;
      const c = of(x);
      if (c !== FAIL) out.push(c);
    }
    return out;
  };
}

/** A record: every key must pass `key`, every value must clean; more than `max` entries fails. */
export function rec<T>(of: Cleaner<T>, key: (k: string) => boolean = () => true, max = Infinity): Cleaner<Record<string, T>> {
  return (v) => {
    if (!isObj(v)) return FAIL;
    const entries = Object.entries(v);
    if (entries.length > max) return FAIL;
    const out: Record<string, T> = {};
    for (const [k, x] of entries) {
      if (!key(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return FAIL;
      const c = of(x);
      if (c === FAIL) return FAIL;
      out[k] = c;
    }
    return out;
  };
}

export function nullable<T>(of: Cleaner<T>): Cleaner<T | null> {
  return (v) => (v === null ? null : of(v));
}

/** An optional property: absent stays absent. */
export function opt<T>(of: Cleaner<T>): Cleaner<T | undefined> {
  return (v) => (v === undefined ? undefined : of(v));
}

export function tuple<A, B>(a: Cleaner<A>, b: Cleaner<B>): Cleaner<[A, B]> {
  return (v) => {
    if (!Array.isArray(v) || v.length !== 2) return FAIL;
    const x = a(v[0]);
    const y = b(v[1]);
    return x === FAIL || y === FAIL ? FAIL : [x, y];
  };
}

/** An object with exactly these properties (others are dropped); an optional one left undefined is omitted. */
export function obj<T>(props: { [K in keyof T]-?: Cleaner<T[K]> }): Cleaner<T> {
  const keys = Object.keys(props) as Array<keyof T>;
  return (v) => {
    if (!isObj(v)) return FAIL;
    const out = {} as T;
    for (const k of keys) {
      const c = props[k](v[k as string]);
      if (c === FAIL) return FAIL;
      if (c !== undefined) out[k] = c;
    }
    return out;
  };
}

/** A tagged union: the branch is chosen by the value of `tag`. */
export function tagged<T>(tag: string, branches: Record<string, Cleaner<T>>): Cleaner<T> {
  return (v) => {
    if (!isObj(v)) return FAIL;
    const t = v[tag];
    const branch = typeof t === 'string' && Object.prototype.hasOwnProperty.call(branches, t) ? branches[t] : undefined;
    return branch ? branch(v) : FAIL;
  };
}

/** Cleans with `c`, then checks the result (a guard from src/model/guards.ts as the last word). */
export function checked<T>(c: Cleaner<T>, guard: (v: unknown) => boolean): Cleaner<T> {
  return (v) => {
    const out = c(v);
    return out !== FAIL && guard(out) ? out : FAIL;
  };
}

/** Falls back to `fallback` instead of failing (a damaged optional part must not sink the whole). */
export function orElse<T>(c: Cleaner<T>, fallback: T): Cleaner<T> {
  return (v) => {
    const out = c(v);
    return out === FAIL ? fallback : out;
  };
}
