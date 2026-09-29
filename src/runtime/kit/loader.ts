/**
 * The Loader inside the sandbox: games cannot fetch files, and models love `this.load.image('boss',
 * 'boss.png')`. Picture loads become art requests (the key gets the student's drawing or its stand-in, at
 * once, so create() finds the texture); sound loads are no-ops (the sound manager makes synth sounds for
 * unknown keys); anything with inline data (data: URLs, JSON objects) loads normally.
 */
import Phaser from 'phaser';
import { registryFor } from './art';
import { env } from './env';

type LoaderFn = (this: Phaser.Loader.LoaderPlugin, ...args: unknown[]) => unknown;

const PICTURES = new Set(['image', 'svg', 'spritesheet', 'atlas', 'atlasXML', 'multiatlas', 'unityAtlas', 'aseprite', 'texture']);
const SOUNDS = new Set(['audio', 'audioSprite']);

interface Entry {
  key: string;
  inline: boolean;
  frameWidth?: number;
  frameHeight?: number;
}

function isInline(url: unknown): boolean {
  if (url === undefined || url === null) return false;
  if (typeof url === 'string') return /^(data|blob):/i.test(url);
  if (Array.isArray(url)) return url.length > 0 && url.every(isInline);
  return typeof url === 'object';
}

function frameSize(v: unknown): { frameWidth?: number; frameHeight?: number } {
  if (typeof v !== 'object' || v === null) return {};
  const o = v as { frameWidth?: unknown; frameHeight?: unknown };
  const w = typeof o.frameWidth === 'number' && o.frameWidth > 0 ? o.frameWidth : undefined;
  const h = typeof o.frameHeight === 'number' && o.frameHeight > 0 ? o.frameHeight : w;
  return { frameWidth: w, frameHeight: h };
}

/** `load.image('a', url)`, `load.image({ key, url })`, `load.image([...])`, spritesheets with frame sizes. */
function entriesOf(args: unknown[]): Entry[] {
  const first = args[0];
  const list = Array.isArray(first) ? first : [first];
  const out: Entry[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      out.push({ key: item, inline: isInline(args[1]), ...frameSize(args[2]) });
    } else if (typeof item === 'object' && item !== null) {
      const o = item as { key?: unknown; url?: unknown; textureURL?: unknown; frameConfig?: unknown };
      if (typeof o.key !== 'string') continue;
      out.push({ key: o.key, inline: isInline(o.url ?? o.textureURL), ...frameSize(o.frameConfig) });
    }
  }
  return out;
}

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  env().post({ type: 'warn', message });
}

function call(loader: Phaser.Loader.LoaderPlugin, type: string, real: LoaderFn, args: unknown[]): unknown {
  const entries = entriesOf(args);
  if (entries.length && entries.every((e) => e.inline)) return real.apply(loader, args);
  if (PICTURES.has(type)) {
    const reg = registryFor(loader.systems.game);
    for (const e of entries) {
      if (!reg) break;
      if (e.frameWidth && e.frameHeight) reg.noteSheet(e.key, e.frameWidth, e.frameHeight);
      reg.raw(e.key);
    }
    return loader;
  }
  if (SOUNDS.has(type)) return loader;
  warnOnce(`Games can't load files from the internet, so this.load.${type}() was skipped.`);
  return loader;
}

/** Replaces the Loader's file types before any game is created (Phaser copies them into every Loader). */
export function patchLoader(): void {
  const FTM = Phaser.Loader.FileTypesManager;
  const originals: Record<string, LoaderFn> = {};
  FTM.install(originals as unknown as Phaser.Loader.LoaderPlugin);
  for (const [type, real] of Object.entries(originals)) {
    if (typeof real !== 'function') continue;
    FTM.register(type, function (this: Phaser.Loader.LoaderPlugin, ...args: unknown[]) {
      return call(this, type, real, args);
    });
  }
}
