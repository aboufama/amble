/**
 * Where the game runtime lives (built by vite/ambleRuntime.ts). Kept out of the `src/play` index so code
 * that only needs the protocol or the standalone builder does not pull in the virtual module.
 */
import url from 'virtual:amble-runtime';

export const runtimeUrl: string = url;
