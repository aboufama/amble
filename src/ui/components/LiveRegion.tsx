/**
 * The two live regions (§3.9): polite for saves, AI phases, "Pip came alive" and Desk tool changes;
 * assertive only for failures that stop work. Write to them with `announce()` (src/state/app.ts).
 */
import { useStore } from '../../state/store';

export function LiveRegion() {
  const polite = useStore((s) => s.app.announce.polite);
  const assertive = useStore((s) => s.app.announce.assertive);
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="live-assertive">
        {assertive}
      </div>
    </>
  );
}
