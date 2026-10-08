import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { checkLinks, type LinkIssue } from '../links/check.js';
import { findAllPrereqCycles } from '../concepts/prereq.js';
import { validateDocument, type Finding } from '../okf/validate.js';
import { isStale } from '../okf/types.js';
import { normalizeSurface } from '../kb/search.js';
import type { BundlePath } from '../util/paths.js';
import { loadTemplates } from '../templates/registry.js';
import { checkSourceFreshness } from './source-freshness.js';
import { extractLinks } from '../markdown/ast.js';
import { classifyLink } from '../links/portable.js';
import { findSecrets } from '../security/secrets.js';

export type MaintainIssue = {
  readonly code: string;
  readonly level: 'error' | 'warning' | 'info';
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
};

export type MaintainReport = {
  readonly scanned: number;
  readonly okfFindings: readonly Finding[];
  readonly linkIssues: readonly LinkIssue[];
  readonly issues: readonly MaintainIssue[];
  readonly okfConformant: boolean;
  readonly summary: Readonly<Record<string, number>>;
};

export async function maintain(
  config: OkbConfig,
  options: { bundle?: Bundle; now?: Date; checkSources?: boolean } = {},
): Promise<MaintainReport> {
  const bundle = options.bundle ?? (await loadBundleFor(config));
  const now = options.now ?? new Date();
  const issues: MaintainIssue[] = [];
  const okfFindings: Finding[] = [];

  for (const { path, reason } of bundle.unreadable) {
    issues.push({
      code: 'UNREADABLE',
      level: 'error',
      path,
      message: reason,
      hint: 'The file was skipped; nothing about it is indexed.',
    });
  }

  for (const [, doc] of bundle.docs) {
    const report = validateDocument(doc, {
      requiredFields: config.okf.productRules.requiredFields,
      allowedTypes: config.okf.productRules.allowedTypes,
      requireSourcesOnGenerated: config.okf.productRules.requireSourcesOnGenerated,
      forbidSelfVerification: config.okf.productRules.forbidSelfVerification,
    });
    okfFindings.push(...report.findings);
  }

  const linkReport = checkLinks(bundle.snapshot, {
    renderers: config.kb.renderers,
    brokenTargetsAre: config.kb.brokenTargetsAre,
  });

  for (const cycle of findAllPrereqCycles(bundle)) {
    issues.push({
      code: 'PREREQ_CYCLE',
      level: 'error',
      path: cycle[0] ?? '(unknown)',
      message: `prerequisite cycle: ${cycle.join(' → ')}`,
      hint: 'Break the loop with x_okb.prereqs, or drop the weaker edge.',
    });
  }

  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const doc = bundle.docs.get(entry.path)!;

    if (isStale(doc.data, now)) {
      issues.push({
        code: 'STALE',
        level: 'warning',
        path: entry.path,
        message: `stale_after ${String(doc.data.stale_after)} has passed`,
        hint: 'Staleness is a date comparison; it says nothing about whether the content is still true.',
      });
    }

    if (entry.trust === 'unverified' && entry.status === 'stable') {
      issues.push({
        code: 'STABLE_BUT_UNVERIFIED',
        level: 'info',
        path: entry.path,
        message: 'marked stable but carries no `verified` entry',
        hint: 'Structural validation never grants technical verification.',
      });
    }

    if (entry.ext.needs_clarification) {
      issues.push({
        code: 'NEEDS_CLARIFICATION',
        level: 'warning',
        path: entry.path,
        message: 'the meaning of this term is still unconfirmed',
      });
    }

    // A style change never rewrites the bundle; it only makes notes eligible.
    const written = entry.ext.writing;
    if (written && typeof written.preset === 'string' && written.preset !== config.writing.preset) {
      issues.push({
        code: 'STYLE_DIFFERS',
        level: 'info',
        path: entry.path,
        message: `written with preset "${written.preset}", the configuration now says "${config.writing.preset}"`,
        hint: 'Nothing is rewritten automatically. Revise a note on request with the okb-garden workflow.',
      });
    }
  }

  issues.push(...(await templateDrift(config, bundle)));
  // Reading original sources is explicit: ordinary maintenance stays in the KB.
  if (options.checkSources) issues.push(...(await checkSourceFreshness(config, bundle)));
  issues.push(...duplicateSurfaces(bundle));
  issues.push(...orphans(bundle));
  issues.push(...(await uncategorized(config, bundle)));
  issues.push(...secretsInNotes(bundle));

  const summary: Record<string, number> = {};
  for (const f of okfFindings) summary[`okf:${f.code}`] = (summary[`okf:${f.code}`] ?? 0) + 1;
  for (const i of linkReport.issues) summary[`link:${i.code}`] = (summary[`link:${i.code}`] ?? 0) + 1;
  for (const i of issues) summary[`kb:${i.code}`] = (summary[`kb:${i.code}`] ?? 0) + 1;

  return {
    scanned: bundle.entries.length,
    okfFindings,
    linkIssues: linkReport.issues,
    issues,
    okfConformant: !okfFindings.some((f) => f.layer === 'okf' && f.level === 'error'),
    summary,
  };
}

/**
 * A note that names a template but lost one of its required sections, typically
 * after a hand edit. Reported, never repaired automatically.
 */
async function templateDrift(config: OkbConfig, bundle: Bundle): Promise<MaintainIssue[]> {
  const templates = new Map((await loadTemplates(config)).map((t) => [t.id, t]));
  const bare = (text: string) => text.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const out: MaintainIssue[] = [];
  for (const entry of bundle.entries) {
    const id = entry.ext.template;
    if (entry.reserved || !id) continue;
    const template = templates.get(id);
    if (!template) {
      out.push({ code: 'TEMPLATE_UNKNOWN', level: 'warning', path: entry.path, message: `declares template "${id}", which this bundle does not define` });
      continue;
    }
    const headings = new Set(entry.headings.map(bare));
    const missing = template.sections
      .filter((s) => s.required && !headings.has(bare(s.heading.fr)) && !headings.has(bare(s.heading.en)))
      .map((s) => s.role);
    if (missing.length) {
      out.push({ code: 'TEMPLATE_DRIFT', level: 'warning', path: entry.path, message: `template "${id}" requires section(s) ${missing.join(', ')}`, hint: `okb template show ${id}` });
    }
  }
  return out;
}

/** Two documents claiming the same surface form without declaring senses. */
function duplicateSurfaces(bundle: Bundle): MaintainIssue[] {
  const bySurface = new Map<string, Set<BundlePath>>();
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    for (const surface of [entry.title, ...(entry.ext.aliases ?? [])]) {
      const key = normalizeSurface(surface);
      if (key.length < 2) continue;
      const paths = bySurface.get(key) ?? new Set<BundlePath>();
      paths.add(entry.path);
      bySurface.set(key, paths);
    }
  }
  const out: MaintainIssue[] = [];
  for (const [surface, matches] of bySurface) {
    const paths = [...matches];
    if (paths.length < 2) continue;
    const undeclared = paths.filter((p) => (bundle.byPath.get(p)?.ext.senses ?? []).length === 0);
    if (undeclared.length < 2) continue;
    out.push({
      code: 'AMBIGUOUS_SURFACE',
      level: 'warning',
      path: paths[0]!,
      message: `"${surface}" resolves to ${paths.length} documents: ${paths.join(', ')}`,
      hint: 'Declare x_okb.senses on each, or rename one; links to this term are suppressed meanwhile.',
    });
  }
  return out;
}

/** Notes no template, type, folder or explicit choice puts in a category: they fall in "other". */
async function uncategorized(config: OkbConfig, bundle: Bundle): Promise<MaintainIssue[]> {
  const { categorise, loadCategories, templateCategories } = await import('../categories/categories.js');
  const { loadTemplates } = await import('../templates/registry.js');
  const [categories, templates] = await Promise.all([loadCategories(config).catch(() => null), loadTemplates(config).catch(() => [])]);
  if (!categories) return [];
  const byTemplate = templateCategories(templates);
  const out: MaintainIssue[] = [];
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    const { category } = categorise({ path: entry.path, type: entry.type, template: entry.ext.template, explicit: (entry.ext as { category?: unknown }).category }, categories, byTemplate);
    if (category !== 'other') continue;
    out.push({ code: 'NO_CATEGORY', level: 'info', path: entry.path, message: 'no template, type or folder gives this note a category', hint: `okb categories set ${entry.path} <category>` });
  }
  return out;
}

/** Documents no other document links to and no index lists. */
function orphans(bundle: Bundle): MaintainIssue[] {
  const linked = new Set<string>();
  for (const [file, text] of bundle.snapshot.files) {
    if (!file.endsWith('.md')) continue;
    for (const link of extractLinks(bundle.docs.get(file)?.body ?? text)) {
      const classification = classifyLink(link.url, file);
      if ((classification.kind === 'internal' || classification.kind === 'internal-asset') && classification.target && classification.target !== file) {
        linked.add(classification.target);
      }
    }
  }
  const out: MaintainIssue[] = [];
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    if (!linked.has(entry.path)) {
      out.push({
        code: 'ORPHAN',
        level: 'info',
        path: entry.path,
        message: 'no document or index links to this one',
        hint: 'Add it to the folder index so it is reachable by progressive disclosure.',
      });
    }
  }
  return out;
}

/**
 * A credential written by hand (OKB itself refuses them in proposals). Only the
 * kind, line and a masked prefix are reported: the report must not leak it.
 */
function secretsInNotes(bundle: Bundle): MaintainIssue[] {
  const out: MaintainIssue[] = [];
  for (const [file, text] of bundle.snapshot.files) {
    for (const f of findSecrets(text)) {
      out.push({
        code: 'SECRET_IN_NOTE',
        level: 'error',
        path: file,
        message: `line ${f.line}: ${f.kind} (${f.masked})`,
        hint: 'Remove it from the note, replace it with a reference (where the secret lives, not the secret) and revoke the key if the KB was ever shared or synced.',
      });
    }
  }
  return out;
}
