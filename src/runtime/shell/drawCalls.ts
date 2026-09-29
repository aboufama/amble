/**
 * Counts WebGL draw calls per frame (Phaser does not), by wrapping the context's draw functions once.
 * The stats and the robot test report it; a jump in draw calls is the usual cause of a slow Chromebook frame.
 */

let counting = 0;
let lastFrame = 0;

export function countDrawCalls(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
  if (!gl) return;
  const target = gl as unknown as Record<string, unknown> & { __ambleCounted?: boolean };
  if (target.__ambleCounted) return;
  target.__ambleCounted = true;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
    const real = target[name];
    if (typeof real !== 'function') continue;
    target[name] = function (this: unknown, ...args: unknown[]) {
      counting++;
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}

/** Call after every frame. */
export function drawCallsFrameDone(): void {
  lastFrame = counting;
  counting = 0;
}

export function drawCallsLastFrame(): number {
  return lastFrame;
}
