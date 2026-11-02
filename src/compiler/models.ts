/**
 * The two ways Amble builds blocks written in words: "Best" (GPT-6.1 Terra, high reasoning) and
 * "Efficient" (GPT-6 Luna, high reasoning, about a tenth of the price). A mode is just a set of
 * model settings: picking one writes them into the settings, and editing the models by hand under
 * Settings → Advanced makes the settings "custom" (neither mode).
 */
import type { AiSettings, ReasoningEffort } from './openai';

export type ModeId = 'best' | 'efficient';

export interface ModelMode {
  id: ModeId;
  /** Shown on the switch. */
  label: string;
  /** Shown in tooltips and Settings. */
  name: string;
  description: string;
  /** Writes the blocks in your own words. */
  model: string;
  reasoningEffort: ReasoningEffort;
  /** Draws compiled costumes (as SVG) and designs compiled sounds. */
  assetModel: string;
}

export const MODES: Record<ModeId, ModelMode> = {
  best: {
    id: 'best',
    label: 'Best',
    name: 'GPT-6.1 Terra, high reasoning',
    description: 'The strongest builds: elaborate games, careful code and art.',
    model: 'gpt-6.1-terra',
    reasoningEffort: 'high',
    assetModel: 'gpt-6.1-terra',
  },
  efficient: {
    id: 'efficient',
    label: 'Efficient',
    // OpenAI's newest Luna is GPT-6 Luna (there is no GPT-6.1 Luna yet). Change it here when one ships.
    name: 'GPT-6 Luna, high reasoning',
    description: 'About a tenth of the price of Best, and quicker. Good for small changes.',
    model: 'gpt-6-luna',
    reasoningEffort: 'high',
    assetModel: 'gpt-6-luna',
  },
};

export const DEFAULT_MODE: ModeId = 'best';

/** The model settings a mode writes. */
export function modeSettings(id: ModeId): Pick<AiSettings, 'model' | 'reasoningEffort' | 'assetModel'> {
  const m = MODES[id];
  return { model: m.model, reasoningEffort: m.reasoningEffort, assetModel: m.assetModel };
}

/** Which mode the settings are in, or null when the models were picked by hand. */
export function modeOf(settings: Pick<AiSettings, 'model' | 'reasoningEffort' | 'assetModel'>): ModeId | null {
  for (const m of Object.values(MODES)) {
    if (settings.model.trim() === m.model && settings.reasoningEffort === m.reasoningEffort && (settings.assetModel.trim() || m.model) === m.assetModel) return m.id;
  }
  return null;
}

/** Image model for compiled costumes when "Image model" art is picked (gpt-image-1 was shut down in October 2026). */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare';

/** Models offered in the Settings model fields (any other id can be typed in). */
export const SUGGESTED_MODELS = ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra'];

/**
 * Models on OpenAI's deprecation list (gpt-5, gpt-5-mini and gpt-5-nano shut down on 11 December
 * 2026; the chat-latest ones already have). Settings saved with one of them move to the default mode.
 */
export const RETIRED_MODELS = new Set(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-5.1-chat-latest', 'gpt-5.2-chat-latest', 'gpt-5.3-chat-latest']);
export const RETIRED_IMAGE_MODELS = new Set(['gpt-image-1']);
