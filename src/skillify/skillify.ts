import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { assertNoSecrets } from '../security/guard.js';
import { loadTemplates } from '../templates/registry.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists, writeTextAtomic } from '../util/fsx.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';

/**
 * From a procedure or process note to a Claude Code skill draft.
 *
 * The draft is deterministic: it reuses the note's own sections (when to use,
 * before you start, steps, checks, troubleshooting) and cites the note. It is a
 * starting point, not a finished skill: the person reviews every step against
 * their real practice, then tests it on a real case. Nothing is installed
 * globally; the caller chooses the folder (a project's `.claude/skills/`).
 */

type Part = 'when' | 'before' | 'steps' | 'verify' | 'troubleshoot';

/** Template roles, across built-in templates, that feed each part of a skill. */
const ROLE_TO_PART: Readonly<Record<string, Part>> = {
  purpose: 'when', frequency: 'when', trigger: 'when',
  prerequisites: 'before', inputs: 'before', tools: 'before',
  steps: 'steps', flow: 'steps',
  verify: 'verify', monitoring: 'verify',
  troubleshoot: 'troubleshoot', failure: 'troubleshoot',
};

type Lang = 'fr' | 'en';
const LABELS: Record<Lang, Record<Part | 'source' | 'draft' | 'use' | 'notUse', string>> = {
  fr: {
    when: 'Quand l’utiliser', before: 'Avant de commencer', steps: 'Étapes', verify: 'Vérifier le résultat',
    troubleshoot: 'Si ça ne marche pas', source: 'Source',
    draft: 'Brouillon créé par `okb skillify` à partir de la note `{path}` (KB `{profile}`), le {date}. Relis chaque étape avec ta pratique réelle, précise quand ne pas utiliser ce skill, puis teste-le sur un cas réel : un skill reste ta méthode, pas celle de l’IA. Supprime ce bloc quand c’est fait.',
    use: 'À utiliser quand', notUse: 'Ne pas utiliser quand : à préciser.',
  },
  en: {
    when: 'When to use it', before: 'Before you start', steps: 'Steps', verify: 'Check the result',
    troubleshoot: 'If it does not work', source: 'Source',
    draft: 'Draft created by `okb skillify` from the note `{path}` (KB `{profile}`) on {date}. Review every step against your real practice, state when NOT to use this skill, then test it on a real case: a skill stays your method, not the AI\'s. Delete this block when done.',
    use: 'Use when', notUse: 'Do not use when: to be stated.',
  },
};

const normalize = (heading: string) =>
  heading.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** Plain text of one Markdown list item or paragraph: no footnotes, links kept as their label. */
export function plainItem(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(Déduction|Inference)\s*:\s*\*\*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function skillName(title: string): string {
  const slug = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (slug.slice(0, 64).replace(/-+$/, '') || 'skill');
}

export type SkillDraft = {
  readonly name: string;
  readonly note: BundlePath;
  readonly title: string;
  readonly content: string;
  readonly counts: Readonly<Record<Part, number>>;
};

function notePath(config: OkbConfig, input: string): BundlePath {
  const rel = isAbsolute(input) ? relative(config.kb.root, input) : input;
  if (rel.startsWith('..') || isAbsolute(rel)) throw new OkbError('E_INVALID', `${input} is not inside the KB (${config.kb.root})`);
  return asBundlePath(rel.split(sep).join('/'));
}

export async function draftSkill(config: OkbConfig, input: string, options: { name?: string; now?: Date } = {}): Promise<SkillDraft> {
  const path = notePath(config, input);
  const bundle = await loadBundleFor(config);
  const doc = bundle.docs.get(path);
  const entry = bundle.byPath.get(path);
  if (!doc || !entry) throw new OkbError('E_NOT_FOUND', `no note ${path} in the KB`, { hint: 'okb ask "<topic>" finds the note path.' });

  // Every heading any template gives to a role that maps to a skill part.
  const headingToPart = new Map<string, Part>();
  for (const template of await loadTemplates(config)) {
    for (const section of template.sections) {
      const part = ROLE_TO_PART[section.role];
      if (!part) continue;
      for (const text of [section.heading.fr, section.heading.en]) {
        if (!headingToPart.has(normalize(text))) headingToPart.set(normalize(text), part);
      }
    }
  }

  const parts: Record<Part, string[]> = { when: [], before: [], steps: [], verify: [], troubleshoot: [] };
  let current: Part | null = null;
  let fence = false;
  for (const line of doc.body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { current = headingToPart.get(normalize(heading[1]!)) ?? null; continue; }
    if (!current || /^#/.test(line) || /^\s*(>|\||<!--)/.test(line) || /^\[\^/.test(line)) continue;
    const text = plainItem(line);
    if (text) parts[current].push(text);
  }
  if (!parts.steps.length) {
    throw new OkbError('E_INVALID', `${path} has no steps section`, {
      hint: 'skillify works on notes written from the procedure, process or automation templates (a "Steps"/"Étapes" or "Flow"/"Déroulé" section).',
    });
  }

  const lang: Lang = config.profile.answer.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const L = LABELS[lang];
  const title = entry.title || path;
  const name = options.name ? skillName(options.name) : skillName(title.replace(/^[^\p{L}\p{N}]+/u, ''));
  const date = (options.now ?? new Date()).toISOString().slice(0, 10);
  const colon = lang === 'fr' ? ' :' : ':';
  const firstUse = parts.when[0] ? ` ${L.use}${colon} ${parts.when[0].replace(/\.$/, '')}.` : '';
  const description = `${(entry.description || title).replace(/\s+/g, ' ').trim()}${firstUse} ${L.notUse}`.slice(0, 1000);
  const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n');
  const sections: string[] = [];
  if (parts.when.length) sections.push(`## ${L.when}\n\n${list(parts.when)}`);
  if (parts.before.length) sections.push(`## ${L.before}\n\n${list(parts.before)}`);
  sections.push(`## ${L.steps}\n\n${parts.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (parts.verify.length) sections.push(`## ${L.verify}\n\n${list(parts.verify)}`);
  if (parts.troubleshoot.length) sections.push(`## ${L.troubleshoot}\n\n${list(parts.troubleshoot)}`);
  sections.push(`## ${L.source}\n\n- \`${path}\` (KB \`${config.profile.id}\`)`);
  const content = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    `# ${title}`,
    '',
    `> ${L.draft.replace('{path}', path).replace('{profile}', config.profile.id).replace('{date}', date)}`,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
  assertNoSecrets({ content }, 'skill draft');
  return {
    name, note: path, title, content,
    counts: { when: parts.when.length, before: parts.before.length, steps: parts.steps.length, verify: parts.verify.length, troubleshoot: parts.troubleshoot.length },
  };
}

/** Write `<dir>/<name>/SKILL.md`. Never inside the KB, never over an existing skill without `force`. */
export async function writeSkillDraft(config: OkbConfig, draft: SkillDraft, dir: string, options: { force?: boolean } = {}): Promise<string> {
  const target = resolve(dir, draft.name, 'SKILL.md');
  const inKb = relative(config.kb.root, target);
  if (!inKb.startsWith('..') && !isAbsolute(inKb)) {
    throw new OkbError('E_FORBIDDEN_PATH', 'a skill is not a KB note: write it outside the KB', { hint: 'For a project skill: --out <project>/.claude/skills' });
  }
  if (!options.force && (await readTextIfExists(target)) !== null) {
    throw new OkbError('E_CONFLICT', `${target} already exists`, { hint: 'Choose another --name, or --force to replace it.' });
  }
  await writeTextAtomic(target, draft.content);
  return target;
}
