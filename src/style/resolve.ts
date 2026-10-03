import { z } from 'zod';
import {
  READER_LEVELS,
  WRITING_KNOBS,
  WRITING_PRESETS,
  type ConceptAssistLevel,
  type OkbConfig,
  type ReaderLevel,
  type WritingPreset,
} from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { PRESETS, type KnobValues, type WritingKnob } from './presets.js';

const KNOB_NAMES = Object.keys(WRITING_KNOBS) as WritingKnob[];

/** The fully resolved style. It is what a dossier records and what rendering reads. */
export const resolvedStyleSchema = z
  .object({
    preset: z.enum(WRITING_PRESETS),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    detail: z.enum(WRITING_KNOBS.detail),
    tone: z.enum(WRITING_KNOBS.tone),
    examples: z.enum(WRITING_KNOBS.examples),
    analogies: z.enum(WRITING_KNOBS.analogies),
    diagrams: z.enum(WRITING_KNOBS.diagrams),
    emojis: z.enum(WRITING_KNOBS.emojis),
    progression: z.enum(WRITING_KNOBS.progression),
    defineTerms: z.enum(WRITING_KNOBS.defineTerms),
    instructions: z.array(z.string().min(1).max(240)).max(12),
  })
  .strict();
export type WritingStyle = z.infer<typeof resolvedStyleSchema>;

export type StyleRequest = {
  /** One-off preset; replaces the configured preset and its knob overrides. */
  readonly preset?: string;
  /** One-off `knob=value` adjustments, applied last. */
  readonly set?: readonly string[];
  /** One-off free-text preferences, appended to the configured ones. */
  readonly notes?: readonly string[];
  readonly domain?: string;
  /** One-off reader level ("explain it as to a beginner"). */
  readonly reader?: string;
};

export type Adjustment = { readonly key: string; readonly value: string; readonly from: 'configuration' | 'request' };

export type EffectiveStyle = {
  readonly style: WritingStyle;
  readonly reader: { readonly level: ReaderLevel; readonly domain: string | null; readonly from: 'request' | 'domain' | 'default' };
  readonly conceptAssist: { readonly level: ConceptAssistLevel; readonly knownTerms: readonly string[] };
  /** Every knob that differs from the preset, and who asked for it. */
  readonly adjustments: readonly Adjustment[];
};

/**
 * Resolve the writing style for one piece of work.
 *
 * Order: preset → configuration layers (defaults → org → team → profile →
 * KB-local, already merged by loadConfig) → this request. Nothing here is
 * persisted: a one-off adjustment is recorded in the dossier that used it.
 */
export function resolveStyle(config: OkbConfig, request: StyleRequest = {}): EffectiveStyle {
  const requestedPreset = request.preset === undefined ? undefined : parsePreset(request.preset);
  const preset: WritingPreset = requestedPreset ?? config.writing.preset;
  const values: KnobValues = { ...PRESETS[preset].values };
  const adjustments: Adjustment[] = [];

  // A one-off preset is a fresh starting point: configured knob overrides belong
  // to the configured preset and would make "expert, this once" half-pedagogical.
  if (requestedPreset === undefined) {
    for (const key of KNOB_NAMES) {
      const configured = config.writing[key];
      if (configured !== undefined && configured !== values[key]) {
        (values as Record<string, string>)[key] = configured;
        adjustments.push({ key, value: configured, from: 'configuration' });
      }
    }
  }

  let language = config.writing.language ?? config.profile.answer.language;
  for (const entry of request.set ?? []) {
    const eq = entry.indexOf('=');
    const key = eq === -1 ? entry : entry.slice(0, eq).trim();
    const value = eq === -1 ? '' : entry.slice(eq + 1).trim();
    if (key === 'language') {
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(value)) throw new OkbError('E_INVALID', `invalid language "${value}"`, { hint: 'Use a code such as fr or en-GB.' });
      language = value;
    } else if ((KNOB_NAMES as string[]).includes(key)) {
      const allowed = WRITING_KNOBS[key as WritingKnob] as readonly string[];
      if (!allowed.includes(value)) {
        throw new OkbError('E_INVALID', `invalid value "${value}" for ${key}`, { hint: `${key}: ${allowed.join(' | ')}` });
      }
      (values as Record<string, string>)[key] = value;
    } else {
      throw new OkbError('E_INVALID', `unknown style setting "${key}"`, {
        hint: `Settable: language, ${KNOB_NAMES.join(', ')}. Use --preset for a starting point and --note for free text.`,
      });
    }
    const existing = adjustments.findIndex((a) => a.key === key);
    if (existing >= 0) adjustments.splice(existing, 1);
    adjustments.push({ key, value, from: 'request' });
  }

  const instructions = [...config.writing.instructions, ...(request.notes ?? []).map((n) => n.trim()).filter(Boolean)];
  const style = resolvedStyleSchema.parse({ preset, language, ...values, instructions });

  const domain = request.domain ?? null;
  if (request.reader !== undefined && !isReaderLevel(request.reader)) {
    throw new OkbError('E_INVALID', `unknown reader level "${request.reader}"`, { hint: `Reader levels: ${READER_LEVELS.join(', ')}` });
  }
  const domainLevel = domain ? config.reader.byDomain[domain] : undefined;
  const conceptLevel = (domain ? config.conceptAssist.byDomain[domain] : undefined) ?? config.conceptAssist.level;

  return {
    style,
    reader: request.reader !== undefined && isReaderLevel(request.reader)
      ? { level: request.reader, domain, from: 'request' }
      : { level: domainLevel ?? config.reader.level, domain, from: domainLevel ? 'domain' : 'default' },
    conceptAssist: { level: conceptLevel, knownTerms: config.conceptAssist.known.slice(0, 40) },
    adjustments,
  };
}

function parsePreset(value: string): WritingPreset {
  if (!(WRITING_PRESETS as readonly string[]).includes(value)) {
    throw new OkbError('E_INVALID', `unknown writing preset "${value}"`, { hint: `Presets: ${WRITING_PRESETS.join(', ')}` });
  }
  return value as WritingPreset;
}

export function isReaderLevel(value: string): value is ReaderLevel {
  return (READER_LEVELS as readonly string[]).includes(value);
}
