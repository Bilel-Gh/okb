import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { checkLinks, type LinkIssue } from '../links/check.js';
import { findAllPrereqCycles } from '../concepts/prereq.js';
import { validateDocument, type Finding } from '../okf/validate.js';
import { isStale } from '../okf/types.js';
import { normalizeSurface } from '../kb/search.js';
import type { BundlePath } from '../util/paths.js';

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
  options: { bundle?: Bundle; now?: Date } = {},
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
  }

  issues.push(...duplicateSurfaces(bundle));
  issues.push(...orphans(bundle));

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

/** Two documents claiming the same surface form without declaring senses. */
function duplicateSurfaces(bundle: Bundle): MaintainIssue[] {
  const bySurface = new Map<string, BundlePath[]>();
  for (const entry of bundle.entries) {
    if (entry.reserved) continue;
    for (const surface of [entry.title, ...(entry.ext.aliases ?? [])]) {
      const key = normalizeSurface(surface);
      if (key.length < 2) continue;
      bySurface.set(key, [...(bySurface.get(key) ?? []), entry.path]);
    }
  }
  const out: MaintainIssue[] = [];
  for (const [surface, paths] of bySurface) {
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

/** Documents no other document links to and no index lists. */
function orphans(bundle: Bundle): MaintainIssue[] {
  const linked = new Set<string>();
  for (const [file, text] of bundle.snapshot.files) {
    if (!file.endsWith('.md')) continue;
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const url = match[1]!;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue;
      const resolved = resolveRelative(file, url.split('#')[0]!);
      if (resolved) linked.add(resolved);
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

function resolveRelative(from: string, url: string): string | null {
  const segments = from.split('/').slice(0, -1);
  for (const part of decodeURIComponent(url).split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/') || null;
}
