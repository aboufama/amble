declare module 'virtual:amble-runtime' {
  /** Absolute URL of the game runtime file (Phaser + the Amble runtime). */
  const url: string;
  export default url;
  /** Absolute URL of the standalone script, which a shared web page appends to the runtime. */
  export const standaloneUrl: string;
}
