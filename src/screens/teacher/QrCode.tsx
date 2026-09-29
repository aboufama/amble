/** A QR code drawn on the device as one SVG path (crisp on the card, on a projector and in print). */
import { useMemo } from 'react';
import { makeQr, qrPath } from '../../school/qr';
import { cx } from '../../ui/cx';

export function QrCode({ text, label, size, className }: { text: string; label: string; size?: number; className?: string }) {
  const qr = useMemo(() => {
    try {
      const code = makeQr(text);
      return { n: code.size, d: qrPath(code) };
    } catch {
      return null;
    }
  }, [text]);
  if (!qr) return null;
  const quiet = 3;
  const box = qr.n + quiet * 2;
  return (
    <svg className={cx('qr', className)} viewBox={`0 0 ${box} ${box}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" data-modules={qr.n}>
      <rect width={box} height={box} className="qr__paper" />
      <path d={qr.d} transform={`translate(${quiet} ${quiet})`} className="qr__ink" />
    </svg>
  );
}
