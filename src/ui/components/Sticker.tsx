/**
 * A drawing as a sticker (§1.1, §3.4): the student's art with its baked die-cut edge, shown flat, as
 * Scratch shows a costume (no shadow, no tilt). Drawings are the only characters in Amble's UI.
 */
import { cx } from '../cx';

export interface StickerProps {
  /** Object URL of the sticker PNG (Store.blobs.url), or null while it loads. */
  src: string | null;
  alt: string;
  size?: number;
  className?: string;
}

export function Sticker({ src, alt, size = 64, className }: StickerProps) {
  return (
    <span className={cx('sticker', className)} style={{ width: size, height: size }}>
      {src ? <img src={src} alt={alt} width={size} height={size} draggable={false} /> : <span className="sticker__empty" role="img" aria-label={alt} />}
    </span>
  );
}
