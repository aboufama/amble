/**
 * Validation for every candidate (§5.7): the core's `validateGame` with the kit's names, the app's
 * budgets and the world's facts (drawn keys, the plan's keys, the teacher's locks), then one more rule
 * of the pipeline's own: a drawn key the model renamed is renamed back, so the drawing never loses its
 * key. Also the line-numbered report a fix request carries.
 */
import { parse, type Node } from 'acorn';
import { simple } from 'acorn-walk';
import MagicString from 'magic-string';
import { validateGame, type Issue, type SourceFile, type ValidateOptions, type ValidationResult } from '../cores/ai';
import { LIMITS } from '../model/limits';
import type { CodeFile, PlanReply, World } from '../model/types';
import { kitManifestFor } from './kit';
import { readStatics, type Spec } from './manifest';
import { sizeOf } from './sizes';

/** The world facts the validator takes (drawn keys, plan keys, locks). */
export type WorldFacts = NonNullable<ValidateOptions['world']>;
type ArtLiteral = NonNullable<WorldFacts['planArt']>[string];

export const CODE_LIMITS = { maxFiles: LIMITS.codeFiles, maxFileBytes: LIMITS.codeFileBytes, maxTotalBytes: LIMITS.codeTotalBytes, maxFileLines: LIMITS.codeFileLines };

export interface Checked extends ValidationResult {
  /** Renamed drawn keys that were put back: [new key the model used, the drawing's key]. */
  keptKeys: Array<{ from: string; to: string }>;
}

function artLiteral(spec: Spec): ArtLiteral {
  const out: ArtLiteral = {};
  for (const [k, v] of Object.entries(spec)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  return out;
}

/** The plan's cast as `static art` entries (what a build must declare). */
export function planArt(plan: PlanReply): Record<string, ArtLiteral> {
  const out: Record<string, ArtLiteral> = {};
  plan.cast.forEach((c, i) => {
    const { w, h } = sizeOf(c.size, c.kind);
    out[c.key] = { kind: c.kind, rig: c.rig, role: c.role, w, h, facing: c.facing, name: c.name, ask: c.ask, about: c.about, pronoun: c.pronoun, priority: i + 1, required: c.required };
  });
  return out;
}

/** What the validator needs to know about the world the candidate belongs to. */
export function worldFacts(world: World, o: { plan?: PlanReply | null } = {}): WorldFacts {
  const statics = readStatics(world.code);
  const previousArt: Record<string, ArtLiteral> = {};
  for (const [k, spec] of Object.entries(statics.art)) previousArt[k] = artLiteral(spec);
  const locked: Record<string, Array<[number, number]>> = {};
  for (const f of world.code) if (f.locked.length) locked[f.path] = f.locked.map(([a, b]) => [a, b]);
  return {
    drawn: Object.values(world.cast)
      .filter((s) => s.art && !s.extra)
      .map((s) => s.key),
    previousArt,
    planArt: o.plan ? planArt(o.plan) : undefined,
    locked,
    previous: world.code.map((f) => ({ path: f.path, content: f.source })),
  };
}

/** Renames every string literal `from` to `to` (and the `static art` key), so a renamed drawn key comes back. */
export function renameArtKey(files: readonly SourceFile[], from: string, to: string): SourceFile[] {
  return files.map((f) => {
    let ast: Node;
    try {
      ast = parse(f.content, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch {
      return f;
    }
    const ms = new MagicString(f.content);
    let changed = false;
    simple(ast, {
      Literal(n) {
        if (n.value === from) {
          ms.overwrite(n.start, n.end, `'${to}'`);
          changed = true;
        }
      },
      Property(n) {
        if (!n.computed && n.key.type === 'Identifier' && n.key.name === from) {
          ms.overwrite(n.key.start, n.key.end, to);
          changed = true;
        }
      },
    });
    return changed ? { path: f.path, content: ms.toString() } : f;
  });
}

export function check(files: readonly SourceFile[], world: WorldFacts): Checked {
  const manifest = kitManifestFor();
  let r = validateGame(files, { manifest, world, limits: CODE_LIMITS });
  const keptKeys: Checked['keptKeys'] = [];
  if (r.renamed.length) {
    let fixed = r.files;
    for (const { from, to } of r.renamed) {
      fixed = renameArtKey(fixed, to, from);
      keptKeys.push({ from: to, to: from });
    }
    const again = validateGame(fixed, { manifest, world, limits: CODE_LIMITS });
    r = { ...again, fixes: [...r.fixes, ...again.fixes] };
  }
  return { ...r, keptKeys };
}

/** One issue as a fix request line: `boss.js:3:5 validate: message`. */
export function issueLine(i: Issue): string {
  return `${i.file}:${i.line}:${i.column} ${i.severity}: ${i.message}`;
}

/** The students' words for a problem (Details in the failed state). */
export function kidIssue(i: Issue): string {
  return `${i.file}: ${i.kid}`;
}

export function toCodeFiles(files: readonly SourceFile[], previous: readonly CodeFile[]): CodeFile[] {
  return files.map((f) => {
    const before = previous.find((p) => p.path === f.path);
    return { path: f.path, source: f.content, authors: before?.source === f.content ? before.authors : [], locked: before?.locked ?? [] };
  });
}
