import { get, set } from 'idb-keyval';
import type { Project } from './types';
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
