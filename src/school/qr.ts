/**
 * QR codes for class links, made on the device with `qrcode-generator` (§2.14): no image service, nothing
 * sent. `qrPath` turns the modules into one SVG path, crisp at any size (the card, Big on a projector, print).
 */
import qrcode from 'qrcode-generator';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

export interface Qr {
  /** Modules per side (21 for version 1, +4 per version). */
  size: number;
  version: number;
  level: QrLevel;
  dark(row: number, col: number): boolean;
}

/**
 * The smallest QR code that holds `text`. Medium error correction reads best from a phone across a room;
 * long links fall back to low so they still fit. Throws when the text is too long for any QR code.
 */
export function makeQr(text: string, level: QrLevel = text.length > 900 ? 'L' : 'M'): Qr {
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  return { size, version: (size - 17) / 4, level, dark: (r, c) => qr.isDark(r, c) };
}

/** One SVG path of the dark modules, in module units (runs of a row merged into one rectangle). */
export function qrPath(qr: Qr): string {
  const parts: string[] = [];
  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.dark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && qr.dark(r, c)) c++;
      parts.push(`M${start} ${r}h${c - start}v1h${start - c}z`);
    }
  }
  return parts.join('');
}

/** Whether a link fits a QR code a class can scan from a projector (version 25 or smaller). */
export function qrScannable(text: string): boolean {
  try {
    return makeQr(text).version <= 25;
  } catch {
    return false;
  }
}
