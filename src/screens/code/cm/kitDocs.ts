/**
 * Kit docs in Look inside (§2.12): hover docs (signature plus one line) and autocomplete of kit members,
 * from `KIT_API` (the §5.16 table until the player core provides it), and the docs of every kit call in a
 * selection (Explain this with the AI helper off).
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorState, Extension, Text } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { KIT_API, type KitApi, type KitMember } from '../../../cores/play';
import { KIT_FALLBACK } from './kitFallback';

export interface KitDoc {
  /** '' for scene members (`this.spawnHero`), a namespace ('fx'), or 'actor' for character methods. */
  ns: string;
  member: KitMember;
}

export interface KitIndex {
  scene: Map<string, KitMember>;
  namespaces: Map<string, Map<string, KitMember>>;
  actor: Map<string, KitMember>;
}

export function kitIndex(api: KitApi = KIT_API.namespaces.length ? KIT_API : KIT_FALLBACK): KitIndex {
  const index: KitIndex = { scene: new Map(), namespaces: new Map(), actor: new Map() };
  for (const ns of api.namespaces) {
    const map = new Map(ns.members.map((m) => [m.name, m]));
    if (ns.name === '') index.scene = map;
    else if (ns.name === 'actor') index.actor = map;
    else index.namespaces.set(ns.name, map);
  }
  return index;
}

let shared: KitIndex | null = null;

/** The index built once from the current API. */
export function sharedKitIndex(): KitIndex {
  shared ??= kitIndex();
  return shared;
}

/** Names that are never characters (no actor docs after `Math.` or `console.`). */
const NOT_CHARACTERS = new Set(['Math', 'Phaser', 'Amble', 'console', 'JSON', 'Object', 'Array', 'String', 'Number', 'Date', 'Promise', 'window', 'document']);

const IDENT = /[A-Za-z0-9_$]/;

export interface KitRef extends KitDoc {
  from: number;
  to: number;
}

/** The kit member at a document position (`this.spawnHero`, `this.fx.shake`, `boss.chase`), if any. */
export function kitRefAt(doc: Text, pos: number, index: KitIndex = sharedKitIndex()): KitRef | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  let s = pos - line.from;
  let e = s;
  while (s > 0 && IDENT.test(text[s - 1])) s--;
  while (e < text.length && IDENT.test(text[e])) e++;
  if (s === e || /^[0-9]/.test(text[s])) return null;
  const name = text.slice(s, e);
  const before = text.slice(0, s).replace(/\s+$/, '');
  if (!before.endsWith('.')) return null;
  const object = before.slice(0, -1).replace(/\s+$/, '');
  const from = line.from + s;
  const to = line.from + e;
  if (/(^|[^\w$.])this$/.test(object)) {
    const member = index.scene.get(name);
    return member ? { ns: '', member, from, to } : null;
  }
  const inNs = /(?:^|[^\w$.])this\s*\.\s*([A-Za-z_$][\w$]*)$/.exec(object);
  if (inNs) {
    const members = index.namespaces.get(inNs[1]);
    if (members) {
      const member = members.get(name);
      return member ? { ns: inNs[1], member, from, to } : null;
    }
  }
  const root = /([A-Za-z_$][\w$]*)$/.exec(object)?.[1];
  if (root && NOT_CHARACTERS.has(root) && !object.includes('.')) return null;
  const member = index.actor.get(name);
  return member ? { ns: 'actor', member, from, to } : null;
}

/** How a member is written in code: `this.fx.shake(intensity?, ms?)`. */
export function kitCall(doc: KitDoc): string {
  if (doc.ns === '') return `this.${doc.member.signature}`;
  if (doc.ns === 'actor') return `.${doc.member.signature}`;
  return `this.${doc.ns}.${doc.member.signature}`;
}

/** Every kit member used between `from` and `to`, once each, in order. */
export function kitDocsInRange(doc: Text, from: number, to: number, index: KitIndex = sharedKitIndex()): KitDoc[] {
  const text = doc.sliceString(from, to);
  const seen = new Set<string>();
  const out: KitDoc[] = [];
  for (const m of text.matchAll(/\.\s*([A-Za-z_$][\w$]*)/g)) {
    const at = from + (m.index ?? 0) + m[0].length - m[1].length;
    const ref = kitRefAt(doc, at, index);
    if (!ref) continue;
    const key = `${ref.ns}.${ref.member.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ns: ref.ns, member: ref.member });
  }
  return out;
}

function docDom(doc: KitDoc): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-kit-doc';
  const sig = document.createElement('code');
  sig.className = 'cm-kit-doc__sig';
  sig.textContent = kitCall(doc);
  const line = document.createElement('p');
  line.className = 'cm-kit-doc__line';
  line.textContent = doc.member.doc;
  dom.append(sig, line);
  return dom;
}

/** Hover docs for kit members. */
export function kitHover(index: KitIndex = sharedKitIndex()): Extension {
  return hoverTooltip(
    (view, pos) => {
      const ref = kitRefAt(view.state.doc, pos, index);
      if (!ref) return null;
      return { pos: ref.from, end: ref.to, above: true, create: () => ({ dom: docDom(ref) }) };
    },
    { hoverTime: 350 },
  );
}

function options(members: Map<string, KitMember>): Completion[] {
  return [...members.values()].map((m) => ({
    label: m.name,
    type: m.kind === 'method' ? 'method' : m.kind === 'namespace' ? 'namespace' : 'property',
    detail: m.signature.startsWith(m.name) ? m.signature.slice(m.name.length) : m.signature,
    info: m.doc,
  }));
}

/** Completions after `this.`, `this.fx.` and (for characters) `boss.`. */
export function kitCompletionSource(index: KitIndex = sharedKitIndex()) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*[\w$]*$|\)\s*\.\s*[\w$]*$/);
    if (!m) return null;
    const dot = m.text.lastIndexOf('.');
    const object = m.text.slice(0, dot).replace(/\s+/g, '');
    const typed = m.text.slice(dot + 1).trimStart();
    const from = m.to - typed.length;
    let members: Map<string, KitMember> | undefined;
    if (object === 'this') members = index.scene;
    else if (object.startsWith('this.') && index.namespaces.has(object.slice(5))) members = index.namespaces.get(object.slice(5));
    else if (!NOT_CHARACTERS.has(object) && !/^(this\.)?(fx|ui|pattern|music|combo|controls|twists|dial)$/.test(object)) members = index.actor;
    if (!members?.size) return null;
    return { from, options: options(members), validFor: /^[\w$]*$/ };
  };
}

export function kitAutocomplete(index: KitIndex = sharedKitIndex()): Extension {
  return autocompletion({ override: [kitCompletionSource(index)], icons: false, activateOnTyping: true });
}

/** The kit member under the main cursor (for the "What's this?" panel). */
export function kitDocAtCursor(state: EditorState, index: KitIndex = sharedKitIndex()): KitRef | null {
  const pos = state.selection.main.head;
  return kitRefAt(state.doc, pos, index) ?? (pos > 0 ? kitRefAt(state.doc, pos - 1, index) : null);
}
