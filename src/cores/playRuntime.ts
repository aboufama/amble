/**
 * Where the game runtime lives (§6.1): the URL `vite/ambleRuntime.ts` gives the built runtime file (or the
 * dev server's copy). Kept apart from `./play` because resolving it needs a page (`location`), so Node
 * tests can import the player barrel. Import this lazily where a game starts:
 *
 *   const { RUNTIME_URL } = await import('../../cores/playRuntime');
 */
export { runtimeUrl as RUNTIME_URL } from '../play/runtimeUrl';
