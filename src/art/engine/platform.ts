/** Platform checks for the view canvas. */

let softwareGL: boolean | null = null;

/**
 * True when Chrome's GL is SwiftShader (a software GPU: CI flags, or a device whose GPU fell back to it).
 * There a desynchronized canvas stalls the page for seconds at a time, so the view uses a normal canvas.
 * Checked once per page.
 */
export function isSoftwareGL(): boolean {
  if (softwareGL !== null) return softwareGL;
  softwareGL = false;
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
    const gl = c?.getContext('webgl') as WebGLRenderingContext | null | undefined;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      softwareGL = /swiftshader|llvmpipe|software/i.test(renderer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    softwareGL = false;
  }
  return softwareGL;
}
