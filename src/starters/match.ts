/**
 * The ladder's local idea match (§5.9, §9): which starter is closest to a student's idea, by the starters'
 * tag words. Offline and instant. The best score wins; ties (and no match at all) go to Moon King.
 */
import type { StarterId } from '../model/types';
import { STARTERS } from './catalog';

/** Lower-case words with simple endings taken off ("ghosts" → ghost, "stacking" → stack). */
export function wordsOf(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!w) continue;
    out.push(w);
    if (w.length > 4 && w.endsWith('ies')) out.push(w.slice(0, -3) + 'y');
    else if (w.length > 3 && /(sh|ch|x|ss)es$/.test(w)) out.push(w.slice(0, -2));
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
    if (w.length > 5 && w.endsWith('ing')) {
      const stem = w.slice(0, -3);
      out.push(stem, stem + 'e', stem.replace(/(.)\1$/, '$1'));
    }
    if (w.length > 4 && w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
    if (w.length > 4 && w.endsWith('er') && !w.endsWith('ter')) out.push(w.slice(0, -2));
  }
  return out;
}

/** How many of the tags appear in the idea (a phrase tag counts when its words come in order). */
export function tagScore(idea: string, tags: readonly string[]): number {
  const words = wordsOf(idea);
  const set = new Set(words);
  const plain = ` ${idea.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  let n = 0;
  for (const tag of tags) {
    if (tag.includes(' ')) {
      if (plain.includes(` ${tag} `) || plain.includes(` ${tag}s `)) n++;
    } else if (set.has(tag)) n++;
  }
  return n;
}

export function matchIdea(idea: string): StarterId {
  let best: StarterId = 'moon-king';
  let bestScore = 0;
  for (const s of STARTERS) {
    if (s.id === 'parade') continue;
    const score = tagScore(idea, s.tags);
    if (score > bestScore) {
      best = s.id as StarterId;
      bestScore = score;
    }
  }
  if (bestScore > 0) {
    const moon = STARTERS.find((s) => s.id === 'moon-king');
    if (moon && tagScore(idea, moon.tags) === bestScore) return 'moon-king';
  }
  return best;
}
