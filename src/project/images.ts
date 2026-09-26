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

/**
 * Makes AI-written SVG safe and well-formed: strips scripts, event handlers, foreign content and
 * external references, and forces explicit width/height/viewBox.
 */
export function sanitizeSvg(svg: string, width: number, height: number): string {
  let s = svg.trim();
  const start = s.search(/<svg\b/i);
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < 0) throw new Error('No <svg> element found.');
  s = s.slice(start, end + 6);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<(image|iframe|use)\b[^>]*\/?>(?:[\s\S]*?<\/\1>)?/gi, (m) => (/href\s*=\s*["']#/.test(m) ? m : ''));
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  s = s.replace(/(xlink:)?href\s*=\s*["'](?!#)[^"']*["']/gi, '');
  s = s.replace(/@import[^;]+;/gi, '');
  s = s.replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none');
  s = s.replace(/<svg\b[^>]*>/i, (tag) => {
    let t = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    if (!/\sviewBox\s*=/.test(t)) t = t.replace(/<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
    if (!/\sxmlns\s*=/.test(t)) t = t.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return t.replace(/<svg/i, `<svg width="${width}" height="${height}"`);
  });
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('The SVG is malformed.');
  }
  return s;
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
