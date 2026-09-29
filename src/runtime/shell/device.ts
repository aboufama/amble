/** What the machine can do: the renderer and GPU a game got, and the effects quality it starts at. */
import Phaser from 'phaser';
import type { PlayerPrefs } from '../../play/protocol';
import { quality } from '../kit/state';

export interface RendererInfo {
  renderer: 'webgl' | 'canvas';
  gpu: string;
  maxTexture: number;
}

export function rendererInfo(game: Phaser.Game): RendererInfo {
  const r = game.renderer;
  if (!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return { renderer: 'canvas', gpu: '', maxTexture: 4096 };
  const gl = r.gl;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 200);
  return { renderer: 'webgl', gpu, maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096 };
}

/**
 * Sets the kit's effects quality: fixed when the editor chose one; otherwise start at 1, and allow 2 only
 * with 8 GB and a real GPU (never software renderers such as SwiftShader or llvmpipe). The kit then adapts
 * to the frame rate.
 */
export function applyQuality(prefs: PlayerPrefs, gpu: string | null): void {
  const q = prefs.quality;
  if (q !== 'auto') {
    quality.level = q;
    quality.cap = q;
    return;
  }
  if (gpu === null) return;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const software = /swiftshader|llvmpipe|software/i.test(gpu);
  quality.cap = memory >= 8 && !software && gpu !== '' ? 2 : 1;
  quality.level = 1;
}
