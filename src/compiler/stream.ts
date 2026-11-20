/**
 * Reading a JSON reply while it streams in: `watchArray` reports one top-level array of the reply
 * as soon as it is complete, long before the rest of the reply has arrived. The compiler uses it
 * to start making a game's art and sounds while the model is still writing the code. `watchReply`
 * reports every top-level field as it completes, and each item of a top-level array as soon as
 * that item is complete (a character's drawing starts as soon as that character is planned).
 */

export interface ReplyWatcher {
  /** A top-level field's whole value, once it is complete. */
  onField?(key: string, value: unknown): void;
  /** One item of a top-level array, once it is complete (`index` counts from 0). */
  onItem?(key: string, item: unknown, index: number): void;
}

/** Returns a function to call with the reply so far (each time more arrives); text is scanned once. */
export function watchReply(watcher: ReplyWatcher): (text: string) => void {
  let pos = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  /** The key of the top-level field being read, and where its value starts. */
  let key = '';
  let valueStart = -1;
  let expectValue = false;
  let itemStart = -1;
  let index = 0;
  let isArray = false;
  const parse = (raw: string): { ok: boolean; value?: unknown } => {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false };
    }
  };
  const field = (end: number, text: string) => {
    const r = parse(text.slice(valueStart, end).trim());
    if (r.ok) watcher.onField?.(key, r.value);
    valueStart = -1;
    expectValue = false;
  };
  const item = (end: number, text: string) => {
    const r = parse(text.slice(itemStart, end));
    if (r.ok) watcher.onItem?.(key, r.value, index);
    index++;
    itemStart = -1;
  };
  return (text: string) => {
    for (; pos < text.length; pos++) {
      const c = text[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          inString = false;
          if (depth === 1 && !expectValue) key = text.slice(stringStart + 1, pos);
          else if (depth === 1 && valueStart >= 0) field(pos + 1, text);
          else if (depth === 2 && isArray && itemStart >= 0) item(pos + 1, text);
        }
        continue;
      }
      if (depth === 1 && expectValue && valueStart < 0 && !/\s/.test(c)) {
        valueStart = pos;
        isArray = c === '[';
        index = 0;
      }
      if (c === '"') {
        inString = true;
        stringStart = pos;
        if (depth === 2 && isArray && itemStart < 0) itemStart = pos;
      } else if (c === ':' && depth === 1) {
        expectValue = true;
      } else if (c === '{' || c === '[') {
        if (depth === 2 && isArray && itemStart < 0) itemStart = pos;
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (depth === 2 && isArray && itemStart >= 0) item(pos + 1, text);
        else if (depth === 1 && valueStart >= 0) field(pos + 1, text);
        else if (depth === 0 && valueStart >= 0) field(pos, text);
      } else if (c === ',') {
        if (depth === 1 && valueStart >= 0) field(pos, text);
        else if (depth === 2 && isArray && itemStart >= 0) item(pos, text);
      }
    }
  };
}

/**
 * Returns a function to call with the reply so far (each time more arrives). Once the top-level
 * property `key` holds a complete array, `onDone` is called with it, once. Text is scanned once,
 * however often the function is called.
 */
export function watchArray(key: string, onDone: (items: unknown[]) => void): (text: string) => void {
  let done = false;
  let pos = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  /** The last string seen directly inside the reply object: the key of what follows. */
  let lastKey = '';
  let arrayStart = -1;
  return (text: string) => {
    if (done) return;
    for (; pos < text.length; pos++) {
      const c = text[pos];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          inString = false;
          if (depth === 1) lastKey = text.slice(stringStart + 1, pos);
        }
        continue;
      }
      if (c === '"') {
        inString = true;
        stringStart = pos;
      } else if (c === '{' || c === '[') {
        if (c === '[' && depth === 1 && lastKey === key && arrayStart < 0) arrayStart = pos;
        depth++;
      } else if (c === '}' || c === ']') {
        depth--;
        if (c === ']' && depth === 1 && arrayStart >= 0) {
          done = true;
          let items: unknown;
          try {
            items = JSON.parse(text.slice(arrayStart, pos + 1));
          } catch {
            return;
          }
          if (Array.isArray(items)) onDone(items);
          return;
        }
      }
    }
  };
}

/** The reply's "title", if it has streamed in already ("" if not). */
export function streamedTitle(text: string): string {
  const m = /^\s*\{\s*"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!m) return '';
  try {
    return String(JSON.parse(`"${m[1]}"`)).trim();
  } catch {
    return '';
  }
}
