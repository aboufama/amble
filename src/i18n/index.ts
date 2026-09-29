/**
 * `t(key, vars)`: every student-facing string, looked up in the English tables merged from `en/*.ts`.
 * Keys are `<table>.<key>` (`t('common.skipToMain')`); `{name}` placeholders take `vars`. Each module owns
 * its table; this file only merges them. Spanish is the first translation after launch.
 */
import { ai } from './en/ai';
import { bones } from './en/bones';
import { common } from './en/common';
import { draw } from './en/draw';
import { files } from './en/files';
import { history } from './en/history';
import { home } from './en/home';
import { school } from './en/school';
import { starters } from './en/starters';
import { world } from './en/world';
import type { Strings } from './types';

export type { Strings } from './types';

/** The merged English tables, by namespace. */
export const TABLES = { common, home, world, draw, bones, ai, files, school, starters, history } as const;

type Tables = typeof TABLES;
export type Namespace = keyof Tables;

/** Every valid key, e.g. 'common.skipToMain'. */
export type MessageKey = { [NS in Namespace]: `${NS}.${keyof Tables[NS] & string}` }[Namespace];

export type Vars = Record<string, string | number>;

const warned = new Set<string>();

/** Looks a string up by key (a missing key returns the key itself). */
export function lookup(key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const table = (TABLES as Record<string, Strings>)[key.slice(0, dot)];
  return table?.[key.slice(dot + 1)];
}

/** Fills `{name}` placeholders; unknown placeholders stay as written. */
export function format(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all));
}

/**
 * A name as it reads inside a sentence: "The Moon King" becomes "the Moon King" ("Drawing the Moon King",
 * "You drew the Moon King"). Other names stay as they are.
 */
export function midSentence(name: string): string {
  return /^The\s+\S/.test(name) ? `t${name.slice(1)}` : name;
}

export function t(key: MessageKey, vars?: Vars): string {
  const text = lookup(key);
  if (text === undefined) {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`Missing string: ${key}`);
    }
    return key;
  }
  return format(text, vars);
}

/** `t` for components (a hook, so a language switch can re-render later). */
export function useT(): typeof t {
  return t;
}
