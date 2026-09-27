import { get, set } from 'idb-keyval';
import { uid } from './ids';
import type { Project, SpriteTarget } from './types';
import { DEFAULT_SETTINGS, type AiSettings } from '../compiler/openai';

const PROJECT_KEY = 'amble:project';
const SETTINGS_KEY = 'amble:settings';

/** Loads the autosaved project (IndexedDB holds big data URLs better than localStorage). */
export async function loadSavedProject(): Promise<Project | null> {
  try {
    const p = await get<Project>(PROJECT_KEY);
    return p && isProject(p) ? p : null;
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  try {
    await set(PROJECT_KEY, project);
  } catch (err) {
    console.warn('Autosave failed', err);
  }
}

export function isProject(value: unknown): value is Project {
  const p = value as Project;
  return Boolean(p && p.format === 'amble' && p.stage && Array.isArray(p.sprites) && (p.mode === '2d' || p.mode === '3d'));
}

/** Reads a .amble file. */
export async function readProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not an Amble project.');
  }
  if (!isProject(data)) throw new Error('That file is not an Amble project.');
  return data;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeFilename(title: string): string {
  return (title || 'game').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'game';
}

export function downloadProject(project: Project): void {
  downloadBlob(new Blob([JSON.stringify(project)], { type: 'application/json' }), `${safeFilename(project.title)}.amble`);
}

const EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'model/gltf-binary': 'glb',
};

/** Right-click > export on a costume or sound: saves its file. */
export async function exportAsset(asset: { name: string; dataUrl: string; mime: string }): Promise<void> {
  const blob = await (await fetch(asset.dataUrl)).blob();
  const ext = EXTENSIONS[asset.mime.split(';')[0]] ?? asset.mime.split('/')[1]?.split(/[;+]/)[0] ?? 'bin';
  downloadBlob(blob, `${safeFilename(asset.name)}.${ext}`);
}

/** Right-click > export on a sprite: an .ambsprite file that "Upload Sprite" reads back. */
export function exportSprite(sprite: SpriteTarget): void {
  downloadBlob(new Blob([JSON.stringify({ format: 'amble-sprite', version: 1, sprite })], { type: 'application/json' }), `${safeFilename(sprite.name)}.ambsprite`);
}

/** Reads an .ambsprite file, with fresh ids so it can be added next to the sprite it came from. */
export async function readSpriteFile(file: File): Promise<SpriteTarget> {
  let data: { format?: string; sprite?: SpriteTarget } | null = null;
  try {
    data = JSON.parse(await file.text());
  } catch {
    /* handled below */
  }
  const sprite = data?.format === 'amble-sprite' ? data.sprite : null;
  if (!sprite || sprite.kind !== 'sprite' || !Array.isArray(sprite.costumes) || !Array.isArray(sprite.sounds)) {
    throw new Error('That file is not an Amble sprite.');
  }
  return {
    ...sprite,
    id: uid('t'),
    costumes: sprite.costumes.map((c) => ({ ...c, id: uid('a') })),
    sounds: sprite.sounds.map((s) => ({ ...s, id: uid('a') })),
  };
}

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AiSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
