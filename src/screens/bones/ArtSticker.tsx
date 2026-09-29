/**
 * The drawing on the Bones sheet, as it is: straight on the white paper like the Desk's sheet, with no
 * sticker edge and no shadow (the look is flat; the drawing is the student's, left alone). Slightly
 * lighter than the bones over it, so the bones read on any colours.
 */
export interface ArtStickerProps {
  url: string;
  /** Where and how big the drawing shows, css px in the sky. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export function ArtSticker({ url, left, top, width, height }: ArtStickerProps) {
  return <img className="bones-sky__art" src={url} alt="" aria-hidden="true" draggable={false} style={{ left, top, width, height }} />;
}
