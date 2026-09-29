/**
 * The AI pipeline as it loads with the first job (./lazy.ts): the full helper and the transport it talks
 * through. Kept apart so everything it reaches (prompts, the patch parser, the validator, the transport)
 * stays out of the app's first load.
 */
export { createAiService } from './service';
export { transportFor } from '../cores/ai';
