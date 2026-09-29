/**
 * Personal information a student might type into a request: the AI doesn't need it and must never
 * get it (map-school §2.7). Found on the original text, and removable with `scrubPii`.
 */

export type PiiKind = 'email' | 'phone' | 'address' | 'name' | 'birthday' | 'school' | 'password';

export interface PiiMatch {
  kind: PiiKind;
  text: string;
  index: number;
}

const STREET = '(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way|Boulevard|Blvd|Circle|Cir|Place|Pl|Terrace|Ter|Parkway|Pkwy|Highway|Hwy|Route|Rte)';

const PATTERNS: Array<[PiiKind, RegExp]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  // US numbers with an area code (the exchange can't start with 0 or 1), or a dashed local number.
  ['phone', /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\s*[2-9]\d{2}\s*\)|[2-9]\d{2})[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?![\d-])|(?<![\d-])[2-9]\d{2}-\d{4}(?![\d-])/g],
  // A house number, a name and a capitalized street word: "12 Maple Street", "450 Elm St".
  ['address', new RegExp(`\\b\\d{1,6}\\s+(?:[A-Za-z][a-z]+\\s+){1,3}${STREET}\\b\\.?`, 'g')],
  ['address', /\b(?:i live (?:at|on)|my address is|my house is (?:at|on))\s+[^.!?\n]{3,60}/gi],
  ['name', /\b(?:my (?:real |full |first |last )?name is|my name's)\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Z][a-z'-]+)?/gi],
  ['birthday', /\b(?:my birthday is|i was born on|i was born in|my birth ?date is)\s+[^.!?\n]{2,40}/gi],
  ['school', /\b(?:[Ii] go to|[Mm]y school is|[Ii] attend)\s+(?:[A-Z][A-Za-z.'-]*\s+){1,5}(?:School|Elementary|Middle|High|Academy|Prep)\b/g],
  ['password', /\b(?:my password is|my pass(?:word|code) is|my pin is)\s+\S+/gi],
];

export function findPii(text: string): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const overlaps = out.some((o) => m.index < o.index + o.text.length && o.index < (m.index ?? 0) + m[0].length);
      if (!overlaps) out.push({ kind, text: m[0], index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The text with personal information taken out ("Remove it for me"). */
export function scrubPii(text: string): string {
  let out = text;
  for (const m of findPii(text).reverse()) out = `${out.slice(0, m.index)}[removed]${out.slice(m.index + m.text.length)}`;
  return out;
}
