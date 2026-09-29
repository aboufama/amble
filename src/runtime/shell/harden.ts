/**
 * Hardening that runs before any game code, inside the sandboxed realm.
 * - WebRTC is the one network path CSP does not govern (STUN packets left the sandbox in the probe despite
 *   default-src 'none'; Chromium ignores `webrtc 'block'`). Games never need it, so it is removed.
 * - alert/confirm/prompt are silently ignored in a sandbox without allow-modals; they become console lines.
 * - window.open is refused by the sandbox anyway; it becomes a warning so the student learns why.
 */
export function harden(warn: (message: string) => void): void {
  for (const name of Object.getOwnPropertyNames(window)) {
    if (!/^(webkit|moz)?RTC/.test(name)) continue;
    try {
      delete (window as unknown as Record<string, unknown>)[name];
    } catch {
      /* non-configurable: nothing to do */
    }
  }
  const w = window as unknown as Record<string, unknown>;
  w.alert = (m?: unknown) => console.log(String(m ?? ''));
  w.confirm = (m?: unknown) => {
    console.log(String(m ?? ''));
    return true;
  };
  w.prompt = (m?: unknown, d?: unknown) => {
    console.log(String(m ?? ''));
    return d === undefined ? '' : String(d);
  };
  w.open = () => {
    warn("Games can't open other pages or windows.");
    return null;
  };
}
