/** Counting the steps hidden below the Footsteps list, for "13 more steps ▾" (pure, for tests). */

export interface Span {
  top: number;
  bottom: number;
}

/**
 * The steps below the visible part of the list. The button and its fade cover the bottom `zone` px, so a
 * step that ends under them counts as hidden, except:
 * - the first step on screen, which is the one being read (a panel shorter than one step plus the zone
 *   would otherwise call its only visible step "1 more step");
 * - anything at all once the list is scrolled to its end (the button and its fade are gone then).
 */
export function stepsBelow(view: Span, steps: readonly Span[], zone: number, atEnd: boolean): number {
  if (atEnd) return 0;
  const line = view.bottom - zone;
  let n = 0;
  let first = true;
  for (const step of steps) {
    if (step.bottom <= view.top) continue;
    if (first) {
      first = false;
      continue;
    }
    if (step.bottom > line) n++;
  }
  return n;
}
