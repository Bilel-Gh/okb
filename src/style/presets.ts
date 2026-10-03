import { WRITING_KNOBS, type WritingPreset } from '../config/schema.js';

export type WritingKnob = keyof typeof WRITING_KNOBS;
export type KnobValues = { -readonly [K in WritingKnob]: (typeof WRITING_KNOBS)[K][number] };

/**
 * Three starting points. A profile picks one and overrides only what differs;
 * adding a fourth preset should need a real reader the three cannot serve.
 */
export const PRESETS: Readonly<Record<WritingPreset, { readonly summary: string; readonly values: KnobValues }>> = {
  standard: {
    summary: 'sober team documentation: usage first, neutral tone, no analogies or emojis',
    values: {
      detail: 'standard',
      tone: 'neutral',
      examples: 'generic',
      analogies: 'off',
      diagrams: 'when-useful',
      emojis: 'off',
      progression: 'usage-first',
      defineTerms: 'inline',
    },
  },
  pedagogique: {
    summary: 'learning material: short sections, project examples, everyday analogies with their limits, diagrams and a few landmark emojis',
    values: {
      detail: 'essential',
      tone: 'warm',
      examples: 'project',
      analogies: 'when-useful',
      diagrams: 'when-useful',
      emojis: 'landmarks',
      progression: 'usage-first',
      defineTerms: 'inline',
    },
  },
  expert: {
    summary: 'reference for practitioners: dense, mechanism first, standard notions not redefined',
    values: {
      detail: 'thorough',
      tone: 'neutral',
      examples: 'none',
      analogies: 'off',
      diagrams: 'when-useful',
      emojis: 'off',
      progression: 'reference',
      defineTerms: 'off',
    },
  },
};
