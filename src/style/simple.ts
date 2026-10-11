import { NOTE_TYPES, noteType } from '../brain/types.js';
import { WRITING_KNOBS, WRITING_PRESETS, type OkbConfig, type WritingPreset } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { PRESETS } from './presets.js';

/**
 * The two writing settings a person reasons with (F2.0-11): a style —
 * technical, normal, simplified — and a length — short, normal, detailed.
 * They are names for what the product already has (the three presets, the
 * `detail` knob), plus one thing that was missing: each kind of note has its
 * own length, because a concept card and a guide are not read the same way.
 */
export type Detail = (typeof WRITING_KNOBS.detail)[number];

const STYLE_WORDS: Readonly<Record<string, WritingPreset>> = { technique: 'expert', technical: 'expert', normal: 'standard', simplifie: 'pedagogique', simplified: 'pedagogique', simple: 'pedagogique' };
const LENGTH_WORDS: Readonly<Record<string, Detail>> = { courte: 'essential', court: 'essential', short: 'essential', normale: 'standard', normal: 'standard', detaillee: 'thorough', detaille: 'thorough', detailed: 'thorough' };
const plain = (word: string) => word.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** « simplifié », « technical »… or a preset's own id. */
export function styleOf(word: string): WritingPreset {
  const w = plain(word);
  if ((WRITING_PRESETS as readonly string[]).includes(w)) return w as WritingPreset;
  const found = STYLE_WORDS[w];
  if (!found) throw new OkbError('E_INVALID', `unknown style "${word}"`, { key: 'styleUnknown', params: { value: word }, hint: 'technique | normal | simplifié' });
  return found;
}

/** « courte », « detailed »… or the knob's own value. */
export function lengthOf(word: string): Detail {
  const w = plain(word);
  if ((WRITING_KNOBS.detail as readonly string[]).includes(w)) return w as Detail;
  const found = LENGTH_WORDS[w];
  if (!found) throw new OkbError('E_INVALID', `unknown length "${word}"`, { key: 'lengthUnknown', params: { value: word }, hint: 'courte | normale | détaillée' });
  return found;
}

/** Kinds whose length the product decides whatever their reading speed. */
const NAMED: Readonly<Record<string, Detail>> = { guide: 'thorough', decision: 'essential', meeting: 'standard' };

/** The product's length for a kind of note, or null when it follows the general setting. A one-minute card is short by nature. */
export function productDetail(type: string): Detail | null {
  if (NAMED[type]) return NAMED[type];
  const speed = noteType(type)?.speed;
  return speed === 'card' || speed === 'brief' ? 'essential' : null;
}

/** What applies to one kind: the person's choice for it, else the product's default. */
export function typeStyle(config: OkbConfig, type: string): { preset?: WritingPreset; detail?: Detail } {
  const own = config.writing.byType[type];
  const detail = own?.detail ?? productDetail(type);
  return { ...(own?.preset ? { preset: own.preset } : {}), ...(detail ? { detail } : {}) };
}

export type TypeDefault = { readonly type: string; readonly preset: WritingPreset; readonly detail: Detail; readonly productDetail: Detail | null; readonly changed: boolean };

/** Every kind of note with the style and the length it gets today. */
export function typeDefaults(config: OkbConfig): TypeDefault[] {
  const ids = [...new Set([...NOTE_TYPES.filter((n) => !n.view).map((n) => n.id), ...Object.keys(config.writing.byType)])];
  return ids.map((type) => {
    const own = typeStyle(config, type);
    const preset = own.preset ?? config.writing.preset;
    return { type, preset, detail: own.detail ?? config.writing.detail ?? PRESETS[preset].values.detail, productDetail: productDetail(type), changed: Boolean(config.writing.byType[type]) };
  });
}
