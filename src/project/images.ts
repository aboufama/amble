/** Browser-side image helpers (costume import, paint editor output, compiled art). */

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/** Width/height of an <svg> from its attributes or viewBox. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  if (w > 0 && h > 0 && !/%/.test(attr('width') ?? '')) return { width: w, height: h };
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return null;
}

/** The SVG text of an SVG data URL (as `svgDataUrl` makes them), or null for anything else. */
export function svgFromDataUrl(url: string): string | null {
  const m = /^data:image\/svg\+xml(;[^,]*)?,/i.exec(url);
  if (!m) return null;
  const body = url.slice(m[0].length);
  try {
    if (!/;base64/i.test(m[1] ?? '')) return decodeURIComponent(body);
    const binary = atob(body);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Making SVG safe
// -----------------------------------------------------------------------------

/**
 * What a picture may be made of: shapes, groups, text, gradients and patterns, clipping and masks,
 * and filters (blur, drop shadow, glow, turbulence), which the art styles need. Nothing here can run
 * code or load anything; whatever is not on the list is dropped.
 */
const SVG_ELEMENTS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feSpecularLighting', 'feDistantLight', 'fePointLight', 'feSpotLight', 'feDisplacementMap', 'feDropShadow', 'feFlood',
  'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feTile', 'feTurbulence',
  'style',
];
/** By lower-case name: SVG names are case-sensitive, and a model's `<lineargradient>` draws nothing. */
const SVG_ELEMENT = new Map(SVG_ELEMENTS.map((name) => [name.toLowerCase(), name]));

/**
 * Dropped with everything inside them: code, foreign and embedded content, animation (it can set
 * a link or a handler later) and notes. Other elements that aren't allowed lose only their own
 * tags: what they hold is looked at piece by piece (a drawing inside a link stays).
 */
const DROPPED_WHOLE = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'feimage', 'video', 'audio', 'canvas',
  'animate', 'animatemotion', 'animatetransform', 'animatecolor', 'set', 'discard', 'mpath', 'handler', 'listener',
  'metadata', 'title', 'desc', 'font', 'font-face', 'cursor',
]);

const SVG_ATTRIBUTE = new Map(
  [
    'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform',
    'clipPathUnits', 'maskUnits', 'maskContentUnits', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'filterUnits', 'primitiveUnits',
    'stdDeviation', 'baseFrequency', 'numOctaves', 'stitchTiles', 'xChannelSelector', 'yChannelSelector', 'edgeMode', 'kernelMatrix', 'kernelUnitLength',
    'preserveAlpha', 'targetX', 'targetY', 'surfaceScale', 'diffuseConstant', 'specularConstant', 'specularExponent', 'limitingConeAngle',
    'pointsAtX', 'pointsAtY', 'pointsAtZ', 'tableValues', 'textLength', 'lengthAdjust', 'startOffset', 'pathLength',
  ].map((name) => [name.toLowerCase(), name]),
);

/** Attributes that point somewhere else (`href` is kept when it points inside the picture). */
const LINK_ATTRIBUTES = new Set(['src', 'data', 'action', 'formaction', 'ping', 'poster', 'background', 'base']);

const MALFORMED = 'The SVG is malformed.';
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Entities as the characters they stand for, so nothing hides behind `&#106;avascript:`. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]\w*);/gi, (_, ref: string) => {
    if (ref[0] !== '#') return XML_ENTITIES[ref.toLowerCase()] ?? '';
    const code = /^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

/** Text for an XML document again (without the control characters XML doesn't allow). */
function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `url(...)` may only point at something in the picture: `url(#glow)`. */
function cleanUrls(value: string): string {
  return value.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)?/gi, (_, double?: string, single?: string, bare?: string) => {
    const target = (double ?? single ?? bare ?? '').trim();
    return /^#[\w.:-]+$/.test(target) ? `url(${target})` : 'none';
  });
}

/**
 * CSS escapes as the characters they stand for (`u\72l(` is `url(` to a browser). No backslash is
 * left afterwards, so what is written out can't be read as an escape again.
 */
function unescapeCss(css: string): string {
  return css
    .replace(/\\(?:([0-9a-f]{1,6})\s?|([^\\]))/gi, (_, hex?: string, char?: string) => {
      if (!hex) return char ?? '';
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    })
    .replace(/\\/g, '');
}

/** CSS (a <style> element or a style attribute) without imports or anything that loads or runs. */
function cleanCss(css: string): string {
  return cleanUrls(unescapeCss(css.replace(/\/\*[\s\S]*?\*\//g, ' ')))
    .replace(/@import[^;]*(;|$)/gi, '')
    .replace(/expression\s*\(|behaviou?r\s*:|-moz-binding\s*:/gi, '')
    .replace(/(?:-webkit-)?(?:image-set|cross-fade|image|element)\s*\([^)]*\)?/gi, 'none');
}

/** One attribute, made safe: its name (in SVG's spelling) and value, or null to drop it. */
function cleanAttribute(name: string, raw: string): [string, string] | null {
  if (!/^[a-z_][\w.-]*(:[a-z_][\w.-]*)?$/i.test(name)) return null;
  const lower = name.toLowerCase();
  const colon = lower.indexOf(':');
  const prefix = colon < 0 ? '' : lower.slice(0, colon);
  const local = lower.slice(colon + 1);
  // Event handlers; namespaces (the root gets the ones it needs); editors' own attributes (inkscape:, sodipodi:).
  if (lower.startsWith('on') || lower === 'xmlns' || (prefix && prefix !== 'xlink' && prefix !== 'xml')) return null;
  if (LINK_ATTRIBUTES.has(local)) return null;
  let value = unescapeCss(decodeEntities(raw));
  if (local === 'href') {
    // Only to something inside this picture (a gradient, a shape to reuse).
    value = value.trim();
    if (!/^#[\w.:-]+$/.test(value)) return null;
  }
  // A script or a document where a colour, a number or a name belongs.
  if (/(?:java|vb|live)script:|^data:/i.test(value.replace(/[\s\u0000-\u001f]+/g, ''))) return null;
  return [SVG_ATTRIBUTE.get(lower) ?? name, lower === 'style' ? cleanCss(value) : cleanUrls(value)];
}

function cleanAttributes(text: string): Array<[string, string]> {
  const attrs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/([^\s=<>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`/]+)))?/g)) {
    const value = m[2] ?? m[3] ?? m[4];
    // An attribute without a value isn't XML.
    if (value === undefined) continue;
    const attr = cleanAttribute(m[1], value);
    if (!attr || seen.has(attr[0])) continue;
    seen.add(attr[0]);
    attrs.push(attr);
  }
  return attrs;
}

const writeAttributes = (attrs: Array<[string, string]>) => attrs.map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join('');

// A comment, CDATA, a processing instruction, a doctype, a closing tag, an opening tag, text, or a "<" that is none of those.
const SVG_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=<>"'/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`/]+))?)*)\s*(\/?)>|([^<]+)|</g;

export interface SanitizeOptions {
  /** Pixel art: edges are drawn without smoothing (`shape-rendering="crispEdges"` on the root). */
  crispEdges?: boolean;
}

/**
 * Makes SVG (written by AI, or imported) safe and well-formed. The picture is read piece by piece
 * and written again from only what is allowed: shapes, text, gradients, patterns, clipping, masks
 * and filters stay; scripts, event handlers, foreign and embedded content, animation, links and
 * every reference outside the picture go. The root gets explicit width/height/viewBox.
 */
export function sanitizeSvg(svg: string, width: number, height: number, opts: SanitizeOptions = {}): string {
  const start = svg.search(/<svg\b/i);
  const close = [...svg.matchAll(/<\/svg\s*>/gi)].pop();
  if (start < 0 || !close || close.index < start) throw new Error('No <svg> element found.');
  const source = svg.slice(start, close.index + close[0].length);

  // out[0] is the root's tag, written at the end (it says which namespaces the picture uses).
  const out: string[] = [''];
  // The elements we are inside: `kept` is the name written, or null for one whose tags were dropped.
  const open: Array<{ name: string; kept: string | null }> = [];
  let root: Array<[string, string]> | null = null;
  let dropping = 0;
  let xlink = false;
  let done = false;
  for (const m of source.matchAll(SVG_TOKEN)) {
    const [token, cdata, closeName, openName, attrText, selfClosing, text] = m;
    if (openName) {
      const lower = openName.toLowerCase();
      if (dropping) {
        if (!selfClosing) dropping++;
        continue;
      }
      if (!root) {
        if (lower !== 'svg' || selfClosing) throw new Error(MALFORMED);
        root = cleanAttributes(attrText);
        open.push({ name: lower, kept: 'svg' });
        continue;
      }
      // (A style sheet holds text, not elements.)
      if (DROPPED_WHOLE.has(lower) || open[open.length - 1].kept === 'style') {
        if (!selfClosing) dropping = 1;
        continue;
      }
      const name = SVG_ELEMENT.get(lower) ?? null;
      if (name) {
        const attrs = cleanAttributes(attrText);
        if (attrs.some(([n]) => n.toLowerCase().startsWith('xlink:'))) xlink = true;
        out.push(`<${name}${writeAttributes(attrs)}${selfClosing ? '/' : ''}>`);
      }
      if (!selfClosing) open.push({ name: lower, kept: name });
    } else if (closeName) {
      if (dropping) {
        dropping--;
        continue;
      }
      const top = open.pop();
      if (!top || top.name !== closeName.toLowerCase()) throw new Error(MALFORMED);
      if (top.kept) out.push(`</${top.kept}>`);
      if (!open.length) {
        done = true;
        break;
      }
    } else if (cdata !== undefined || text !== undefined) {
      if (dropping) continue;
      // Text only means something in a style sheet or a <text>.
      let inside: string | null = null;
      for (let i = open.length - 1; i >= 0 && !inside; i--) inside = open[i].kept;
      const content = cdata !== undefined ? cdata : decodeEntities(text);
      if (inside === 'style') out.push(escapeXml(cleanCss(content)));
      else if (inside === 'text' || inside === 'tspan' || inside === 'textPath') out.push(escapeXml(content));
    } else if (token === '<' && !dropping) {
      // Not a tag an XML parser would take: nothing of it is passed on.
      throw new Error(MALFORMED);
    }
  }
  if (!root || !done) throw new Error(MALFORMED);

  const attrs = root.filter(([name]) => !/^(width|height)$/i.test(name) && !(opts.crispEdges && name.toLowerCase() === 'shape-rendering'));
  if (!attrs.some(([name]) => name === 'viewBox')) attrs.unshift(['viewBox', `0 0 ${width} ${height}`]);
  if (opts.crispEdges) attrs.push(['shape-rendering', 'crispEdges']);
  if (attrs.some(([n]) => n.toLowerCase().startsWith('xlink:'))) xlink = true;
  out[0] = `<svg xmlns="http://www.w3.org/2000/svg"${xlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''} width="${width}" height="${height}"${writeAttributes(attrs)}>`;
  const clean = out.join('');
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error(MALFORMED);
  }
  return clean;
}

/** Draws an image into a canvas of the given size ("contain" or "cover"), returning a PNG data URL. */
export async function resizeImage(
  url: string,
  width: number,
  height: number,
  fit: 'contain' | 'cover' = 'contain',
): Promise<string> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return url;
  const scale =
    fit === 'contain'
      ? Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
      : Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}

/** Crops transparent borders. Returns the new image and where the old center moved. */
export async function trimTransparent(url: string): Promise<{ dataUrl: string; width: number; height: number; offsetX: number; offsetY: number }> {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { dataUrl: url, width: img.naturalWidth, height: img.naturalHeight, offsetX: 0, offsetY: 0 };
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { dataUrl: url, width, height, offsetX: 0, offsetY: 0 };
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
  return { dataUrl: out.toDataURL('image/png'), width: w, height: h, offsetX: minX, offsetY: minY };
}

/** Rasterizes any image to a small PNG thumbnail data URL. */
export async function thumbnail(url: string, size = 96): Promise<string> {
  return resizeImage(url, size, size, 'contain');
}
