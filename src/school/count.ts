/**
 * Counted strings ("1 AI change", "3 AI changes"): `tn` uses the table's `<key>One` when n is 1, so English
 * reads right without a plural library. A translation can add its own `One` forms (or leave them out).
 */
import { format, lookup, t, type MessageKey, type Vars } from '../i18n';

export function tn(key: MessageKey, n: number, vars: Vars = {}): string {
  const one = n === 1 ? lookup(`${key}One`) : undefined;
  return one === undefined ? t(key, { ...vars, n }) : format(one, { ...vars, n });
}
