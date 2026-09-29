/**
 * The core `Player` on its own, for PlayerHost to load when the first game starts. `./play` re-exports it
 * too, but that barrel loads with the app (protocol constants), and a dynamic import of it would not split
 * the Player (its frames, the robot test, the srcdoc bootstrap) out of the first load.
 */
export { Player } from '../play/player';
