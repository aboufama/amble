/** Reading the JSON object out of a model's reply, tolerating what non-strict providers add around it. */

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Finds and parses the JSON object in a reply: plain JSON, JSON in a ```json fence, or JSON with
 * prose before or after it (sliced from the first `{` to the last `}`).
 */
export function parseJsonReply(text: string): JsonParseResult {
  let t = text.replace(/^﻿/, '').trim();
  if (!t) return { ok: false, error: 'The reply was empty.' };
  const fence = /```(?:json|JSON)?[ \t]*\n([\s\S]*?)\n?```/.exec(t);
  if (fence && !t.startsWith('{')) t = fence[1].trim();
  if (!t.startsWith('{')) {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
  }
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (err) {
    return { ok: false, error: `The reply wasn't valid JSON (${(err as Error).message}).` };
  }
}
