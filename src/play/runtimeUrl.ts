/**
 * Where the game runtime lives (built by vite/ambleRuntime.ts). Kept out of the `src/play` index so code
 * that only needs the protocol or the standalone builder does not pull in the virtual module.
 */
import url, { standaloneUrl as standalone } from 'virtual:amble-runtime';

export const runtimeUrl: string = url;
/** The standalone script (binding drawings, the ▶ Play card), which a shared web page appends to the runtime. */
export const standaloneUrl: string = standalone;
