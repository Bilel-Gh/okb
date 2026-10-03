import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists } from '../util/fsx.js';
import { asBundlePath } from '../util/paths.js';
import { BUILTIN_TEMPLATES, type Localized, type NoteTemplate, type TemplateSection } from './builtin.js';

const localized = z.object({ fr: z.string().trim().min(1), en: z.string().trim().min(1) }).strict();
const heading = z.object({
  fr: z.string().trim().min(1).regex(/^[^\r\n]+$/),
  en: z.string().trim().min(1).regex(/^[^\r\n]+$/),
}).strict();
const CONCEPT_ROLES = new Set(['definition', 'analogy', 'how', 'example', 'diagram', 'pitfalls', 'source']);
const templateSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  okfType: z.string().min(1),
  folder: z.string().min(1),
  label: localized,
  when: localized,
  sections: z.array(z.object({
    role: z.string().regex(/^[a-z][a-z0-9-]*$/),
    emoji: z.string().regex(/^[^\r\n]*$/).default(''),
    heading,
    required: z.boolean().default(false),
    guide: localized,
  }).strict()).min(1),
  tips: z.array(localized).default([]),
}).strict().superRefine((t, context) => {
  const seen = new Set<string>();
  for (const [i, section] of t.sections.entries()) {
    if (seen.has(section.role)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'role'], message: `duplicate role "${section.role}"` });
    seen.add(section.role);
    if (t.id === 'concept' && !CONCEPT_ROLES.has(section.role)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections', i, 'role'], message: `unsupported concept role "${section.role}"` });
    }
  }
  if (t.id === 'concept') for (const role of ['definition', 'source']) {
    if (!t.sections.some((s) => s.role === role && s.required)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message: `concept template requires the mandatory "${role}" role` });
    }
  }
  try {
    asBundlePath(t.folder);
    if (t.folder.split('/').some((part) => part === '..' || part === '.')) throw new Error('non-canonical folder');
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['folder'], message: 'folder must be a relative bundle directory without dot segments' });
  }
});

/**
 * Built-in templates, overridden or extended by `<kb>/.okb/templates/*.yaml`.
 * A KB-local file with a built-in id replaces it entirely, so a team can impose
 * its own house structure on its own bundle.
 */
export async function loadTemplates(config: OkbConfig): Promise<NoteTemplate[]> {
  const byId = new Map<string, NoteTemplate>(BUILTIN_TEMPLATES.map((t) => [t.id, t]));
  const dir = resolve(config.kb.root, '.okb', 'templates');
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => /\.ya?ml$/.test(n)).sort();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new OkbError('E_CONFIG', 'cannot read KB-local note templates', { cause });
    }
  }
  const localIds = new Set<string>();
  for (const name of names) {
    const raw = await readTextIfExists(resolve(dir, name));
    if (raw === null) continue;
    let data: unknown;
    try { data = YAML.parse(raw); } catch (cause) {
      throw new OkbError('E_CONFIG', `invalid YAML in note template ${name}`, { cause });
    }
    const parsed = templateSchema.safeParse(data);
    if (!parsed.success) {
      throw new OkbError('E_CONFIG', `invalid note template ${name}`, { detail: { issues: parsed.error.issues } });
    }
    if (name.replace(/\.ya?ml$/, '') !== parsed.data.id) {
      throw new OkbError('E_CONFIG', `note template ${name} must declare id "${name.replace(/\.ya?ml$/, '')}"`);
    }
    if (localIds.has(parsed.data.id)) throw new OkbError('E_CONFIG', `duplicate local note template "${parsed.data.id}"`);
    localIds.add(parsed.data.id);
    byId.set(parsed.data.id, parsed.data as NoteTemplate);
  }
  return [...byId.values()];
}

export async function getTemplate(config: OkbConfig, id: string): Promise<NoteTemplate> {
  const all = await loadTemplates(config);
  const found = all.find((t) => t.id === id);
  if (!found) {
    throw new OkbError('E_INVALID', `unknown note template "${id}"`, { hint: `Templates: ${all.map((t) => t.id).join(', ')}` });
  }
  return found;
}

export function pick(text: Localized, language: string): string {
  return language.toLowerCase().startsWith('fr') ? text.fr : text.en;
}

/** "🎯 À quoi ça sert", or "À quoi ça sert" when landmark emojis are off. */
export function sectionHeading(section: TemplateSection, language: string, emojis: boolean): string {
  const text = pick(section.heading, language);
  return emojis && section.emoji ? `${section.emoji} ${text}` : text;
}

/** The guidance Claude reads before writing a note of this kind (`okb template show`). */
export function renderTemplateGuide(t: NoteTemplate, language: string): string {
  const fr = language.toLowerCase().startsWith('fr');
  const lines = [
    `# ${fr ? 'Modèle' : 'Template'} « ${t.id} » — ${pick(t.label, language)}`,
    '',
    `${fr ? 'Quand' : 'When'} : ${pick(t.when, language)}`,
    `${fr ? 'Type OKF' : 'OKF type'} : ${t.okfType} · ${fr ? 'dossier conseillé' : 'suggested folder'} : ${t.folder}/`,
    '',
    `## ${fr ? 'Sections, dans cet ordre' : 'Sections, in this order'}`,
    '',
  ];
  for (const section of t.sections) {
    const tag = section.required ? (fr ? 'obligatoire' : 'required') : (fr ? 'facultative' : 'optional');
    lines.push(`- \`${section.role}\` — **${sectionHeading(section, language, true)}** (${tag}) : ${pick(section.guide, language)}`);
  }
  lines.push('');
  lines.push(fr
    ? 'Dans le dossier, une section de rôle porte `role` et pas de `heading` : le titre vient du modèle. Une section libre porte `heading` et pas de `role`.'
    : 'In the dossier, a role section has `role` and no `heading`: the heading comes from the template. A free section has `heading` and no `role`.');
  for (const tip of t.tips) lines.push(`- ${pick(tip, language)}`);
  return `${lines.join('\n')}\n`;
}

/** A Markdown skeleton for writing a note of this kind by hand (e.g. in Obsidian). */
export function renderSkeleton(t: NoteTemplate, language: string, emojis: boolean): string {
  const fr = language.toLowerCase().startsWith('fr');
  const frontmatter = YAML.stringify({
    type: t.okfType,
    title: '',
    description: '',
    status: 'draft',
    generated: { by: `human:<${fr ? 'toi' : 'you'}>`, at: `<${fr ? 'date ISO' : 'ISO date'}>` },
    x_okb: { v: 1, template: t.id },
  }, { lineWidth: 0 });
  const front = ['---', frontmatter.trimEnd(), '---', ''];
  const body = t.sections.flatMap((section) => [
    `## ${sectionHeading(section, language, emojis)}`,
    '',
    `<!-- ${pick(section.guide, language)}${section.required ? (fr ? ' (obligatoire)' : ' (required)') : ''} -->`,
    '',
  ]);
  return `${[...front, ...body].join('\n').trimEnd()}\n`;
}
