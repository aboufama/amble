/**
 * The controls row's key hints (§2.6) and the request tag's words (§2.6), as pure functions: which keys
 * to show for a game, and how Amble names a member it asks for ("The Grumbles are only bones.").
 */
import { t, type MessageKey } from '../i18n';
import type { Action, CastMember, Pronoun, World } from '../model/types';

export interface Hint {
  keys: string;
  word: MessageKey;
  /** The game's own word for the action when it renames it (Wobble Tower's Space drops a crate: "drop"). */
  label?: string;
}

/** The kit's usual keys (src/runtime/kit/controls.ts DEFAULT_BINDINGS), as students read them. */
const USUAL: Partial<Record<Action, string>> = { jump: 'Space', fire: 'X', dash: 'Shift', action: 'E' };

/** Short names for keys the student picked (KeyboardEvent.code). */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const named: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  };
  return named[code] ?? code;
}

/** Actions a game's code reads (the manifest only knows what the game read so far, often the title card's). */
export function actionsFromCode(code: readonly { source: string }[]): Action[] {
  const text = code.map((f) => f.source).join('\n');
  const out = new Set<Action>();
  const add = (...a: Action[]) => a.forEach((x) => out.add(x));
  if (/\.platformer\(/.test(text)) add('left', 'right', 'jump');
  // A runner runs by itself: jumping is all the player does.
  if (/\.runner\(/.test(text)) add('jump');
  if (/\.topdown\(|\.flyer\(/.test(text)) add('left', 'right', 'up', 'down');
  if (/\.shooter\(|(pressed|held)\(['"]fire/.test(text)) add('fire');
  if (/\bdash\s*:\s*true|(pressed|held)\(['"]dash/.test(text)) add('dash');
  if (/(pressed|held)\(['"]action/.test(text)) add('action');
  for (const a of ['left', 'right', 'up', 'down', 'jump'] as const) if (new RegExp(`(pressed|held)\\(['"]${a}`).test(text)) add(a);
  return [...out];
}

const NAMED: readonly Action[] = ['jump', 'fire', 'dash', 'action'];

/**
 * The words a game gives its actions: `static config = { controls: { jump: 'DROP' } }` names its touch
 * buttons, and the key hints follow it ("Space drop", not "Space jump", when Space drops a crate). A word
 * that is just the action's own name ('JUMP' for jump) changes nothing.
 */
export function actionWords(code: readonly { source: string }[]): Partial<Record<Action, string>> {
  const text = code.map((f) => f.source).join('\n');
  const block = /\bcontrols\s*:\s*\{([^{}]*)\}/.exec(text);
  const out: Partial<Record<Action, string>> = {};
  if (!block) return out;
  for (const [, key, word] of block[1].matchAll(/\b(\w+)\s*:\s*['"]([^'"\n]{1,20})['"]/g)) {
    const action = key as Action;
    const said = word.trim().toLowerCase();
    if (NAMED.includes(action) && said && said !== action) out[action] = said;
  }
  return out;
}

/** What to show hints for: the code's actions, plus movement and shooting keys the game reported reading. */
export function hintActions(reported: readonly Action[], code: readonly { source: string }[]): Action[] {
  const moves = reported.filter((a) => a !== 'action' && a !== 'pause');
  return [...new Set([...actionsFromCode(code), ...moves])];
}

/** Up to four hints, in the order students need them: move, jump, shoot, dash. */
export function keyHints(actions: readonly Action[], controls: World['controls'], words: Partial<Record<Action, string>> = {}): Hint[] {
  const has = (a: Action) => actions.includes(a);
  const keyOf = (a: Action) => (controls[a]?.length ? keyLabel(controls[a]![0]) : USUAL[a] ?? '');
  const named = (a: Action, word: MessageKey): Hint => (words[a] ? { keys: keyOf(a), word, label: words[a] } : { keys: keyOf(a), word });
  const out: Hint[] = [];
  if (has('left') || has('right')) out.push({ keys: t('world.keyArrowsLR'), word: 'world.actionMove' });
  if (has('jump')) out.push(named('jump', 'world.actionJump'));
  else if (has('up') || has('down')) out.push({ keys: t('world.keyArrowsUD'), word: 'world.actionUpDown' });
  if (has('fire')) out.push(named('fire', 'world.actionFire'));
  if (has('dash')) out.push(named('dash', 'world.actionDash'));
  if (has('action')) out.push(named('action', 'world.actionAction'));
  return out.filter((h) => h.keys).slice(0, 4);
}

// ------------------------------------------------------------------ the request tag's words

/** "the Moon King" when the game says so ("Draw the Moon King, a giant boss"), else just the name. */
export function withArticle(m: Pick<CastMember, 'name' | 'ask'>): string {
  const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bthe\\s+${escaped}\\b`, 'i').test(m.ask) ? `the ${m.name}` : m.name;
}

export function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function aOrAn(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

const PRONOUN_LINES: Record<Pronoun, MessageKey> = { him: 'world.requestHim', her: 'world.requestHer', them: 'world.requestThem', it: 'world.requestIt' };

export interface RequestCopy {
  title: string;
  body: string;
  button: string;
}

/** The tag's words for a member (a group when several play at once; the Warm-up's own words). */
export function requestCopy(m: Pick<CastMember, 'name' | 'ask' | 'count' | 'pronoun'>, warmup: boolean): RequestCopy {
  if (warmup) {
    return { title: t('world.requestWarmup', { name: withArticle(m) }), body: t('world.requestWarmupSub'), button: t('world.drawOne', { name: withArticle(m) }) };
  }
  if (m.count > 1) {
    return { title: t('world.requestAre', { names: plural(m.name) }), body: t('world.requestGroup'), button: t('world.drawOne', { name: aOrAn(m.name) }) };
  }
  return { title: t('world.requestIs', { name: capital(withArticle(m)) }), body: t(PRONOUN_LINES[m.pronoun]), button: t('world.drawOne', { name: withArticle(m) }) };
}
