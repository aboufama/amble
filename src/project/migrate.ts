import type { Project } from './types';

/**
 * Brings projects saved with older block sets up to date. Every project that is loaded
 * (autosave, file, restore) goes through this. (Placeholder: the real conversion lands with
 * the new compiler.)
 */
export function migrateProject(project: Project): Project {
  return project;
}
