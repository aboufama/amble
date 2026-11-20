/**
 * Drawings in progress, for the screen to show while a game is made: the SVG an art request has
 * written so far, cut at its last whole tag and closed, so it can be shown as it is drawn, shape by
 * shape. (Shown in an <img>, where an SVG can't run scripts or load anything.)
 */

/** The `nth` "svg" string of a JSON reply streaming in (from 0): its text so far, and whether it is complete. */
export function svgSoFar(json: string, nth = 0): { svg: string; done: boolean } | null {
  const re = /"svg"\s*:\s*"/g;
  let m: RegExpExecArray | null = null;
  for (let i = 0; i <= nth; i++) {
    m = re.exec(json);
    if (!m) return null;
  }
  let out = '';
  for (let i = m!.index + m![0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return { svg: out, done: true };
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = json[i + 1];
    if (e === undefined) break;
    if (e === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e === 'b' || e === 'f' ? '' : e;
      i += 1;
    }
  }
  return { svg: out, done: false };
}

/** An SVG cut off part way, made whole: up to its last complete tag, with the tags still open closed. Null before its <svg> tag is. */
export function closeSvg(partial: string): string | null {
  const start = partial.indexOf('<svg');
  if (start < 0) return null;
  let text = partial.slice(start, partial.lastIndexOf('>') + 1);
  if (!text) return null;
  const open: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) {
      const at = open.lastIndexOf(m[2]);
      if (at >= 0) open.length = at;
    } else if (!m[4]) open.push(m[2]);
  }
  // Nothing open: it is whole.
  if (!open.length) return /<\/svg>\s*$/.test(text) ? text : null;
  if (open[0] !== 'svg') return null;
  // Cut inside a <style>: its half a rule could restyle everything, so it waits until it is whole.
  const style = open.indexOf('style');
  if (style >= 0) {
    text = text.slice(0, text.lastIndexOf('<style'));
    open.length = style;
  }
  for (let i = open.length - 1; i >= 0; i--) text += `</${open[i]}>`;
  return text;
}

/** A data URL for an <img>. */
export const sketchUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
