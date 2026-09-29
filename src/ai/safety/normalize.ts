/**
 * Text folding for the local filter. Words are matched whole, on several views of the same text,
 * so disguises ("h4te", "fuuuun", "s p a c e d") don't slip by and innocent words that merely
 * contain a bad one ("class", "Sussex", "therapist") never match.
 */

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l', '+': 't' };

/** Lowercase, no accents, no apostrophes ("don't" -> "dont"). */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc'`]/g, '');
}

function pad(t: string): string {
  return ` ${t.replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/** Digits and symbols inside words read as letters: "h4te" -> "hate", "$3x" -> "sex". Plain numbers stay. */
function unleet(text: string): string {
  return fold(text).replace(/[a-z0-9@$!|+]+/g, (w) => (/[a-z]/.test(w) && /[0-9@$!|+]/.test(w) ? w.replace(/[0-9@$!|+]/g, (c) => LEET[c] ?? c) : w));
}

/** Runs of three or more of a letter squeezed to `keep` ("fuuuun" -> "fun"/"fuun"). */
function squeeze(view: string, keep: 1 | 2): string {
  return view.replace(/([a-z])\1{2,}/g, keep === 1 ? '$1' : '$1$1');
}

/**
 * Single letters spaced out ("s p a c e d") joined into a word. With `keepArticle`, a leading
 * one-letter word stays apart ("a s p a c e d" -> "a spaced").
 */
function joinSpaced(view: string, keepArticle: boolean): string {
  return view.replace(/(?<= )((?:[a-z] ){2,}[a-z])(?= )/g, (m) => (keepArticle && /^[ai] /.test(m) && m.length >= 7 ? `${m[0]} ${m.slice(2).replace(/ /g, '')}` : m.replace(/ /g, '')));
}

/** The views a phrase is looked for in. Every view is space-padded, so ` word ` matches whole words. */
export function views(text: string): string[] {
  const l = pad(unleet(text));
  return [...new Set([pad(fold(text)), l, squeeze(l, 1), squeeze(l, 2), joinSpaced(l, false), joinSpaced(l, true)])];
}

/** A phrase list entry as a regex over a view: words whole, `*` for "any ending" ("porn*"). */
export function phraseRegex(entry: string): RegExp {
  const words = entry
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '*' : `\\${c}`)).replace(/\*/g, '[a-z]*'));
  return new RegExp(` ${words.join(' ')} `);
}
