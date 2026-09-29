/**
 * The old name of the wish toast (WishToast.tsx), kept for callers that still import it (the world view
 * places `SteerToastHost`). The host now shows both a dial or twist the device matched and a wish that
 * landed ("Done! …" See what changed, Undo).
 */
export { SteerToast, WishToastHost as SteerToastHost, steerText, type SteerToastProps } from './WishToast';
