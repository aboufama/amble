/**
 * The lamppost: the "l" of the wordmark and, alone on `--bg-deep`, the favicon (§3.5). Its lantern glows.
 */
export function Lamppost({ height = 40, glow = true }: { height?: number; glow?: boolean }) {
  return (
    <svg className="lamppost" width={(height * 18) / 48} height={height} viewBox="0 0 18 48" aria-hidden="true" focusable="false">
      {glow && <circle className="lamppost__glow" cx="9" cy="10" r="9" />}
      <path className="lamppost__post" d="M9 46.2c-.2-9.6-.1-19.2.1-28.8" />
      <path className="lamppost__cap" d="M4.4 5.2c3-.9 6.2-.9 9.2 0" />
      <path className="lamppost__lantern" d="M5.6 6.2h6.8l-.6 8.4c-.1.7-.6 1.2-1.3 1.2H7.5c-.7 0-1.2-.5-1.3-1.2z" />
      <path className="lamppost__cap" d="M9 5.1V2.6" />
    </svg>
  );
}
