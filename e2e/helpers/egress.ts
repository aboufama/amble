/**
 * `trackEgress` (§8.4, §10.2): the privacy law as a test. Any request whose origin is neither the app nor
 * `https://ai.test` is a violation, and so is any request the player iframe makes (games get their code,
 * art and sounds from the editor, never from the network). `data:`, `blob:` and `about:` URLs are local.
 *
 * The `test` from `./app` tracks egress in every test and fails it at the end; call this directly only to
 * inspect violations mid-test.
 */
import type { Page, Request } from '@playwright/test';
import { AI_ORIGIN } from './mockAi';

export interface Egress {
  /** "GET https://fonts.example/x (main frame)". */
  violations: string[];
  /** Every request seen, for assertions ("the app made no AI request"). */
  requests: Array<{ url: string; method: string; mainFrame: boolean }>;
  /** Throws with the list when there are violations. */
  assertClean(): void;
  stop(): void;
}

function isLocal(url: string): boolean {
  return /^(data|blob|about|chrome-extension|devtools):/i.test(url);
}

export function trackEgress(page: Page, o: { appOrigin?: string; allow?: string[] } = {}): Egress {
  const allowed = new Set([AI_ORIGIN, ...(o.allow ?? [])]);
  // The app's origin: given, or the first page the main frame navigates to.
  let app = o.appOrigin ?? null;
  const violations: string[] = [];
  const requests: Egress['requests'] = [];
  const onRequest = (req: Request) => {
    const url = req.url();
    let mainFrame = true;
    try {
      mainFrame = req.frame() === page.mainFrame();
    } catch {
      // A service worker's own request: it belongs to the app origin's worker.
      mainFrame = true;
    }
    requests.push({ url, method: req.method(), mainFrame });
    if (isLocal(url)) return;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      violations.push(`${req.method()} ${url} (unreadable URL)`);
      return;
    }
    if (app === null && mainFrame && req.isNavigationRequest()) app = origin;
    if (!mainFrame) {
      violations.push(`${req.method()} ${url} (made by a frame: games may not use the network)`);
      return;
    }
    if (origin !== app && !allowed.has(origin)) violations.push(`${req.method()} ${url} (main frame)`);
  };
  page.on('request', onRequest);
  return {
    violations,
    requests,
    assertClean() {
      if (violations.length) throw new Error(`Requests left the app:\n${violations.join('\n')}`);
    },
    stop() {
      page.off('request', onRequest);
    },
  };
}
