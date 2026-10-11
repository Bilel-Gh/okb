import { afterEach, describe, expect, it } from 'vitest';
import type { OkbConfig } from '../src/config/schema.js';
import { readSettings, writeSetting } from '../src/settings/settings.js';
import { renderBrief } from '../src/style/brief.js';
import { resolveStyle } from '../src/style/resolve.js';
import { lengthOf, styleOf, typeDefaults } from '../src/style/simple.js';
import { OkbError } from '../src/util/errors.js';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';

const boxes: Sandbox[] = [];
afterEach(async () => { await Promise.all(boxes.splice(0).map((s) => s.cleanup())); });

async function profile(writing: Record<string, unknown> = {}) {
  const s = await makeSandbox({ profileId: 'reader', answerLanguage: 'fr' });
  boxes.push(s);
  const config = await s.config();
  return { s, config: { ...config, writing: { ...config.writing, ...writing } } as OkbConfig };
}
const detail = (config: OkbConfig, type?: string, set: string[] = []) => resolveStyle(config, { ...(type ? { type } : {}), set }).style.detail;

describe('writing settings: a style, a length, and a default per kind of note (F2.0-11)', () => {
  it('a concept is short, a guide detailed, a decision short, a meeting report normal', async () => {
    const { config } = await profile();
    expect(['concept', 'guide', 'decision', 'meeting'].map((type) => detail(config, type))).toEqual(['essential', 'thorough', 'essential', 'standard']);
    const concept = resolveStyle(config, { type: 'concept' });
    expect(concept.adjustments).toContainEqual({ key: 'detail', value: 'essential', from: 'type' });
    expect(concept.type).toBe('concept');
  });

  it('a short decision keeps its why: the brief says so', async () => {
    const { config } = await profile();
    const brief = renderBrief(resolveStyle(config, { type: 'decision' }));
    expect(brief).toContain('decision');
    expect(brief).toMatch(/pourquoi/);
    expect(renderBrief(resolveStyle(config, { type: 'concept' }))).not.toMatch(/garde son pourquoi/);
  });

  it('a kind without a default follows the person’s general length', async () => {
    const { config } = await profile({ detail: 'thorough' });
    expect(detail(config, 'feature')).toBe('thorough');
    expect(detail(config)).toBe('thorough');
    // A kind with a default keeps it: what is said for one kind is more precise than the general setting.
    expect(detail(config, 'concept')).toBe('essential');
    expect(detail(config, 'a-kind-nobody-knows')).toBe('thorough');
  });

  it('the person’s choice for a kind wins over the product’s default, and a one-off wish over both', async () => {
    const { config } = await profile({ byType: { concept: { detail: 'thorough' } } });
    expect(detail(config, 'concept')).toBe('thorough');
    expect(detail(config, 'concept', ['detail=standard'])).toBe('standard');
    expect(resolveStyle(config, { type: 'concept', set: ['detail=standard'] }).adjustments).toContainEqual({ key: 'detail', value: 'standard', from: 'request' });
  });

  it('a kind can have its own style, whatever the general one', async () => {
    const { config } = await profile({ preset: 'expert', byType: { tutorial: { preset: 'pedagogique' } } });
    const tutorial = resolveStyle(config, { type: 'tutorial' }).style;
    expect([tutorial.preset, tutorial.analogies, tutorial.tone]).toEqual(['pedagogique', 'when-useful', 'warm']);
    expect(resolveStyle(config, { type: 'feature' }).style.preset).toBe('expert');
  });

  it('the simple words name the presets and the lengths, in French and in English', () => {
    expect(['technique', 'technical', 'normal', 'simplifié', 'simplifie', 'simple'].map(styleOf)).toEqual(['expert', 'expert', 'standard', 'pedagogique', 'pedagogique', 'pedagogique']);
    expect(['courte', 'short', 'normale', 'normal', 'détaillée', 'detaillee', 'detailed'].map(lengthOf)).toEqual(['essential', 'essential', 'standard', 'standard', 'thorough', 'thorough', 'thorough']);
    // The ids of the product still work.
    expect([styleOf('expert'), lengthOf('thorough')]).toEqual(['expert', 'thorough']);
    expect(() => styleOf('poétique')).toThrow(OkbError);
    expect(() => lengthOf('énorme')).toThrow(OkbError);
  });

  it('the list of kinds shows the product’s default and what the person changed', async () => {
    const { config } = await profile({ byType: { concept: { detail: 'standard' }, feature: { detail: 'essential' } } });
    const rows = typeDefaults(config);
    expect(rows.find((r) => r.type === 'concept')).toEqual({ type: 'concept', preset: 'standard', detail: 'standard', productDetail: 'essential', changed: true });
    expect(rows.find((r) => r.type === 'guide')).toMatchObject({ detail: 'thorough', changed: false });
    expect(rows.find((r) => r.type === 'feature')).toMatchObject({ detail: 'essential', productDetail: null, changed: true });
    // A one-minute card is short by nature.
    expect(rows.find((r) => r.type === 'recipe')).toMatchObject({ detail: 'essential', productDetail: 'essential', changed: false });
  });

  it('the length of a kind is a setting like the others, and the profile stays valid', async () => {
    const { s } = await profile();
    const before = (await readSettings('reader', s.env)).find((v) => v.def.key === 'writing.byType.concept.detail')!;
    expect([before.value, before.isDefault]).toEqual(['essential', true]);
    await writeSetting('reader', 'writing.byType.concept.detail', 'thorough', s.env);
    expect(resolveStyle(await s.config(), { type: 'concept' }).style.detail).toBe('thorough');
    await expect(writeSetting('reader', 'writing.byType.concept.detail', 'énorme', s.env)).rejects.toMatchObject({ key: 'settingBadValue' });
  });
});
