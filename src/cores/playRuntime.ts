/**
 * Where the game runtime lives (§6.1): the URL `vite/ambleRuntime.ts` gives the built runtime file (or the
 * dev server's copy), and the standalone script's (what a shared web page adds after the runtime: binding
 * its drawings and the ▶ Play card). Kept apart from `./play` because resolving them needs a page
 * (`location`), so Node tests can import the player barrel. Import this lazily where a game starts:
 *
 *   const { RUNTIME_URL } = await import('../../cores/playRuntime');
 */
export { runtimeUrl as RUNTIME_URL, standaloneUrl as STANDALONE_URL } from '../play/runtimeUrl';
