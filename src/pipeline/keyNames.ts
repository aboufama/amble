/**
 * Cast and dial keys as people say them. Apart from ./manifest (which reads game code with the validator),
 * so the AI cards on the First page and New world can name things without loading the code tools.
 */

/** "moonKing" -> "Moon King". */
export function humanKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : key;
}
