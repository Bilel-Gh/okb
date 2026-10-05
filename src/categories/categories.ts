import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import type { OkbConfig } from '../config/schema.js';
import { OkbError } from '../util/errors.js';
import { readTextIfExists } from '../util/fsx.js';
import type { Localized } from '../templates/builtin.js';

/**
 * Note categories: what kind of knowledge a note holds, at a glance. One
 * colour and one emoji per category, the same in the graph, the note list,
 * the reader, the review and the terminal, so a growing KB stays readable.
 *
 * A note's category comes from (in order) an explicit `x_okb.category`, its
 * template, its OKF `type`, then its folder. Nothing is stored for derived
 * categories: renaming or recolouring a category never rewrites notes.
 * A KB can rename, recolour, map or add categories in `.okb/categories.yaml`.
 */
export type Category = {
  readonly id: string;
  readonly label: Localized;
  /** One note of this category ("un concept"). */
  readonly singular: Localized;
  readonly emoji: string;
  /** For light backgrounds. */
  readonly color: string;
  /** For dark backgrounds. */
  readonly colorDark: string;
  /** 256-colour terminal code. */
  readonly ansi: number;
  readonly description: Localized;
  readonly templates: readonly string[];
  readonly types: readonly string[];
  readonly folders: readonly string[];
};

const c = (
  id: string, emoji: string, fr: string, en: string, oneFr: string, oneEn: string, color: string, colorDark: string, ansi: number,
  descFr: string, descEn: string, templates: string[], types: string[], folders: string[],
): Category => ({ id, emoji, label: { fr, en }, singular: { fr: oneFr, en: oneEn }, color, colorDark, ansi, description: { fr: descFr, en: descEn }, templates, types, folders });

export const OTHER = 'other';

export const BUILTIN_CATEGORIES: readonly Category[] = [
  c('concept', '💡', 'Concepts', 'Concepts', 'Concept', 'Concept', '#7c3aed', '#a78bfa', 141,
    'Une notion expliquée en une minute : définition, analogie, pièges.', 'One notion explained in a minute: definition, analogy, traps.',
    ['concept'], ['Concept', 'Glossary'], ['concepts']),
  c('guide', '📘', 'Comprendre', 'Understand', 'Guide', 'Guide', '#2563eb', '#60a5fa', 75,
    'Comprendre un sujet ou un système : comment ça marche, où regarder.', 'Understand a topic or a system: how it works, where to look.',
    ['guide', 'repo-overview', 'repo-architecture', 'repo-interfaces', 'repo-codemap'], ['Guide', 'Reference', 'Overview', 'Explanation', 'Article', 'Architecture'], ['guides', 'reference', 'architecture']),
  c('howto', '🪜', 'Faire', 'Do', 'Procédure ou tuto', 'Procedure or tutorial', '#059669', '#34d399', 78,
    'Faire quelque chose pas à pas : procédures à suivre et tutos pour apprendre en faisant.', 'Do something step by step: procedures to follow and tutorials to learn by doing.',
    ['procedure', 'tutorial', 'repo-start', 'repo-delivery'], ['Runbook', 'Tutorial', 'HowTo', 'Procedure'], ['procedures', 'tutos', 'tutorials']),
  c('process', '🔁', 'Process et outils', 'Processes and tools', 'Process ou outil', 'Process or tool', '#0891b2', '#22d3ee', 44,
    'Comment l’équipe travaille, les outils utilisés et ce qui est automatisé.', 'How the team works, the tools used and what is automated.',
    ['process', 'tool', 'automation'], ['Process', 'Tool', 'Automation', 'Workflow'], ['process', 'processus', 'outils', 'tools', 'automatisations']),
  c('case', '🧯', 'Cas et retours', 'Cases and lessons', 'Cas', 'Case', '#ea580c', '#fb923c', 209,
    'Ce qui s’est réellement passé : cas clients, incidents résolus, et ce qu’on en retient.', 'What really happened: client cases, solved incidents, and what to keep from them.',
    ['experience', 'client-case'], ['Experience', 'CaseStudy', 'Incident', 'Postmortem'], ['experiences', 'cas-clients', 'clients', 'incidents']),
  c('ticket', '🎫', 'Tickets', 'Tickets', 'Ticket', 'Ticket', '#4f46e5', '#818cf8', 105,
    'Un ticket fait sur un repo : le besoin, ce qui a changé, ce qu’on en retient pour la suite.', 'A ticket done on a repository: the need, what changed, what to keep for next time.',
    ['repo-ticket'], ['Ticket'], ['tickets']),
  c('decision', '⚖️', 'Décisions', 'Decisions', 'Décision', 'Decision', '#e11d48', '#fb7185', 204,
    'Un choix et ses raisons, pour ne pas le refaire ni le défaire par erreur.', 'A choice and its reasons, so it is neither redone nor undone by mistake.',
    ['decision'], ['Decision', 'ADR'], ['decisions', 'adr']),
  c('source', '🗣️', 'Réunions et sources', 'Meetings and sources', 'Réunion ou source', 'Meeting or source', '#ca8a04', '#facc15', 220,
    'L’essentiel d’un échange, d’une réunion, d’une vidéo ou d’un document lu.', 'The essentials of a discussion, meeting, video or document read.',
    ['meeting'], ['Meeting', 'Source', 'Transcript'], ['reunions', 'meetings', 'sources']),
  c('path', '🧭', 'Parcours', 'Learning paths', 'Parcours', 'Learning path', '#c026d3', '#e879f9', 207,
    'Un chemin de lecture : quelles notes lire, dans quel ordre, pour maîtriser un sujet.', 'A reading path: which notes to read, in which order, to master a topic.',
    ['path'], ['Path', 'LearningPath', 'MOC'], ['parcours', 'paths']),
  c(OTHER, '📄', 'Autres', 'Other', 'Note', 'Note', '#64748b', '#94a3b8', 246,
    'Les notes sans catégorie : donne-leur un modèle pour les ranger.', 'Notes without a category: give them a template to file them.',
    [], [], []),
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const localized = z.object({ fr: z.string().min(1), en: z.string().min(1) }).strict();
const localCategory = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: localized.optional(),
  singular: localized.optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().regex(HEX).optional(),
  colorDark: z.string().regex(HEX).optional(),
  ansi: z.number().int().min(0).max(255).optional(),
  description: localized.optional(),
  templates: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  folders: z.array(z.string()).optional(),
}).strict();
const fileSchema = z.object({ categories: z.array(localCategory) }).strict();

/**
 * Built-in categories, with KB-local changes from `<kb>/.okb/categories.yaml`:
 * a known id is updated field by field, a new id is added before "other".
 * A template moved to another category leaves the category it came from.
 */
export async function loadCategories(config: Pick<OkbConfig, 'kb'>): Promise<Category[]> {
  const raw = await readTextIfExists(resolve(config.kb.root, '.okb', 'categories.yaml'));
  if (raw === null) return [...BUILTIN_CATEGORIES];
  let data: unknown;
  try { data = YAML.parse(raw); } catch (cause) { throw new OkbError('E_CONFIG', 'invalid YAML in .okb/categories.yaml', { cause }); }
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) throw new OkbError('E_CONFIG', 'invalid .okb/categories.yaml', { detail: { issues: parsed.error.issues } });
  return mergeCategories(BUILTIN_CATEGORIES, parsed.data.categories);
}

export function mergeCategories(base: readonly Category[], local: readonly z.infer<typeof localCategory>[]): Category[] {
  let out = [...base];
  for (const item of local) {
    const known = out.find((x) => x.id === item.id);
    // Templates, types and folders a category claims leave the category that had them.
    const claimed = new Set(item.templates ?? []);
    const claimedTypes = new Set((item.types ?? []).map((t) => t.toLowerCase()));
    const claimedFolders = new Set(item.folders ?? []);
    out = out.map((x) => (x.id === item.id ? x : {
      ...x,
      templates: x.templates.filter((t) => !claimed.has(t)),
      types: x.types.filter((t) => !claimedTypes.has(t.toLowerCase())),
      folders: x.folders.filter((f) => !claimedFolders.has(f)),
    }));
    if (known) {
      out = out.map((x) => (x.id === item.id ? { ...x, ...defined(item) } as Category : x));
    } else {
      const added: Category = {
        id: item.id, label: item.label ?? { fr: item.id, en: item.id }, singular: item.singular ?? item.label ?? { fr: item.id, en: item.id },
        emoji: item.emoji ?? '📁', color: item.color ?? '#475569', colorDark: item.colorDark ?? item.color ?? '#94a3b8', ansi: item.ansi ?? 250,
        description: item.description ?? { fr: '', en: '' }, templates: item.templates ?? [], types: item.types ?? [], folders: item.folders ?? [],
      };
      const at = out.findIndex((x) => x.id === OTHER);
      out.splice(at === -1 ? out.length : at, 0, added);
    }
  }
  return out;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export type Categorised = { readonly category: string; readonly via: 'explicit' | 'template' | 'type' | 'folder' | 'none' };

/** The category of one note, and what decided it. */
export function categorise(
  note: { readonly path: string; readonly type?: unknown; readonly template?: unknown; readonly explicit?: unknown },
  categories: readonly Category[],
  templateCategory: ReadonlyMap<string, string> = new Map(),
): Categorised {
  const ids = new Set(categories.map((x) => x.id));
  if (typeof note.explicit === 'string' && ids.has(note.explicit)) return { category: note.explicit, via: 'explicit' };
  if (typeof note.template === 'string' && note.template) {
    const fromTemplate = templateCategory.get(note.template) ?? categories.find((x) => x.templates.includes(note.template as string))?.id;
    if (fromTemplate && ids.has(fromTemplate)) return { category: fromTemplate, via: 'template' };
  }
  if (typeof note.type === 'string' && note.type) {
    const lower = note.type.toLowerCase();
    const byType = categories.find((x) => x.types.some((t) => t.toLowerCase() === lower));
    if (byType) return { category: byType.id, via: 'type' };
  }
  const segments = note.path.toLowerCase().split('/').slice(0, -1);
  for (const segment of segments) {
    const byFolder = categories.find((x) => x.folders.includes(segment));
    if (byFolder) return { category: byFolder.id, via: 'folder' };
  }
  return { category: OTHER, via: 'none' };
}

export function categoryById(categories: readonly Category[], id: string): Category {
  return categories.find((x) => x.id === id) ?? categories.find((x) => x.id === OTHER) ?? BUILTIN_CATEGORIES[BUILTIN_CATEGORIES.length - 1]!;
}

/** Templates that declare their category (KB-local templates may). */
export function templateCategories(templates: readonly { id: string; category?: string }[]): Map<string, string> {
  return new Map(templates.filter((t) => t.category).map((t) => [t.id, t.category!]));
}
