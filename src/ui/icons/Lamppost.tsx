/**
 * The lamppost: the "l" of the wordmark (§3.5), drawn flat: a straight post, a roof line and an orange
 * lantern, with no glow. It is the wordmark's letter only, not an icon of its own.
 */
export function Lamppost({ height = 40 }: { height?: number; /** Retired: the lantern never glows. */ glow?: boolean }) {
  return (
    <svg className="lamppost" width={(height * 18) / 48} height={height} viewBox="0 0 18 48" aria-hidden="true" focusable="false">
      <path className="lamppost__post" d="M9 46V17.4" />
      <path className="lamppost__cap" d="M4.5 5.2h9M9 5.2V2.6" />
      <path className="lamppost__lantern" d="M5.6 6.4h6.8l-.6 8.2a1.2 1.2 0 0 1-1.2 1.1H7.4a1.2 1.2 0 0 1-1.2-1.1z" />
    </svg>
  );
}
