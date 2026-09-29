/**
 * The one inline script of the player iframe, in a module with no imports: vite.config.ts hashes it at
 * config time for the editor page's CSP (srcdoc frames inherit that policy), and Node's own loader can
 * read this file as it is. src/play/bootstrap.ts builds the frame's document around it.
 */

/** Tags every message between the editor and a player frame. */
export const PLAYER_CHANNEL = 'amble-player';

/**
 * Exactly what runs in the iframe before the runtime: asks the editor for the runtime ('boot') and runs
 * the posted bytes (Phaser + Amble runtime) as blob: scripts. Changing it changes its hash, which is
 * computed wherever it is needed (never hard-coded).
 */
export const PLAYER_BOOT =
  "window.__ambleBoot=performance.now();addEventListener('message',function b(e){var d=e.data;" +
  `if(e.source!==parent||!d||d.channel!=='${PLAYER_CHANNEL}'||d.type!=='runtime')return;removeEventListener('message',b);` +
  "d.scripts.forEach(function(x){var s=document.createElement('script');s.async=false;" +
  "s.src=URL.createObjectURL(new Blob([x],{type:'text/javascript'}));document.head.appendChild(s)})});" +
  `parent.postMessage({channel:'${PLAYER_CHANNEL}',type:'boot'},'*')`;
