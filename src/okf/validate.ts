import { OkfDocument, isReservedFilename } from './document.js';
import {
  OKF_VERSION,
  isValidActor,
  isValidTimestamp,
  verifiedList,
  type OkfFrontmatter,
  type OkfSource,
} from './types.js';

export type FindingLevel = 'error' | 'warning' | 'info';

/**
 * `okf`     — the specification's own conformance rules (§11). Deliberately permissive.
 * `product` — this product's house rules. Failing them is never an OKF violation.
 */
export type FindingLayer = 'okf' | 'product';

export type Finding = {
  readonly layer: FindingLayer;
  readonly level: FindingLevel;
  readonly code: string;
  readonly path: string;
  readonly field?: string;
  readonly message: string;
  readonly hint?: string;
};

export type ValidationReport = {
  readonly findings: Finding[];
  readonly okfConformant: boolean;
  readonly productCompliant: boolean;
};

export type ProductRules = {
  /** Frontmatter keys every concept document must carry. */
  requiredFields: string[];
  /** Allowed `type` values; empty means "anything goes" (OKF does not register types). */
  allowedTypes: string[];
  /** Require a `sources` entry when the document was produced from a source. */
  requireSourcesOnGenerated: boolean;
  /** Reject `verified` written by a non-human actor on freshly generated content. */
  forbidSelfVerification: boolean;
};

export const DEFAULT_PRODUCT_RULES: ProductRules = {
  requiredFields: ['type', 'title', 'description', 'status', 'generated'],
  allowedTypes: [],
  requireSourcesOnGenerated: false,
  forbidSelfVerification: true,
};

/** Spec §11. A bundle is conformant when every non-reserved `.md` parses and has a `type`. */
export function validateOkfConformance(doc: OkfDocument): Finding[] {
  const out: Finding[] = [];
  const at = doc.path;

  if (doc.reserved) {
    if (doc.hasFrontmatter) {
      const isRootIndex = doc.path === 'index.md';
      const keys = Object.keys(doc.data);
      const onlyVersion = keys.length === 1 && keys[0] === 'okf_version';
      if (!(isRootIndex && onlyVersion)) {
        out.push({
          layer: 'okf',
          level: 'error',
          code: 'OKF_RESERVED_FRONTMATTER',
          path: at,
          message:
            'reserved files carry no frontmatter; only a bundle-root index.md may declare okf_version',
          hint: 'Spec §8.',
        });
      } else if (doc.data.okf_version !== OKF_VERSION) {
        out.push({
          layer: 'okf',
          level: 'warning',
          code: 'OKF_VERSION_MISMATCH',
          path: at,
          field: 'okf_version',
          message: `bundle declares okf_version "${String(doc.data.okf_version)}", this build targets ${OKF_VERSION}`,
        });
      }
    }
    if (doc.path.endsWith('log.md')) for (const line of doc.body.split('\n').filter(l => /^#{1,6}\s+\d{4}[-/]/.test(l))) {
      const date = line.replace(/^#{1,6}\s+/, '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) out.push({ layer: 'okf', level: 'error', code: 'OKF_LOG_DATE', path: at, message: 'log date headings must be real ISO YYYY-MM-DD dates' });
    }
    return out;
  }

  if (!doc.hasFrontmatter) {
    out.push({
      layer: 'okf',
      level: 'error',
      code: 'OKF_NO_FRONTMATTER',
      path: at,
      message: 'concept document has no YAML frontmatter block',
      hint: 'Spec §11.1.',
    });
    return out;
  }

  if (typeof doc.data.type !== 'string' || doc.data.type.trim() === '') {
    out.push({
      layer: 'okf',
      level: 'error',
      code: 'OKF_MISSING_TYPE',
      path: at,
      field: 'type',
      message: '`type` is required and must be a non-empty string',
      hint: 'Spec §4.1 — it is the only always-required key.',
    });
  }

  // §11: optional families are soft guidance for consumers, not a reason to reject a bundle.
  out.push(...[...checkTimestampFamily(doc.data, at), ...checkSources(doc.data.sources, at)].map(f => ({ ...f, level: 'warning' as const })));
  return out;
}

function checkTimestampFamily(fm: OkfFrontmatter, at: string): Finding[] {
  const out: Finding[] = [];
  if (fm.generated !== undefined) {
    const g = fm.generated;
    if (typeof g !== 'object' || g === null || !isValidActor((g as { by?: unknown }).by)) {
      out.push({
        layer: 'okf',
        level: 'error',
        code: 'OKF_BAD_GENERATED_BY',
        path: at,
        field: 'generated.by',
        message: '`generated.by` must be an actor: `human:<id>`, `process:<id>` or `<tool>/<version>`',
        hint: 'Spec §7.',
      });
    } else if (g.at !== undefined && !isValidTimestamp(g.at)) {
      out.push({
        layer: 'okf',
        level: 'error',
        code: 'OKF_BAD_TIMESTAMP',
        path: at,
        field: 'generated.at',
        message: '`generated.at` must be ISO 8601 with an explicit offset',
      });
    }
  }
  for (const [i, v] of verifiedList(fm).entries()) {
    if (!isValidActor(v?.by)) {
      out.push({
        layer: 'okf',
        level: 'error',
        code: 'OKF_BAD_VERIFIED_BY',
        path: at,
        field: `verified[${i}].by`,
        message: '`verified[].by` must follow the actor convention',
      });
    }
    if (v?.at !== undefined && !isValidTimestamp(v.at)) {
      out.push({
        layer: 'okf',
        level: 'error',
        code: 'OKF_BAD_TIMESTAMP',
        path: at,
        field: `verified[${i}].at`,
        message: '`verified[].at` must be ISO 8601 with an explicit offset',
      });
    }
  }
  if (fm.stale_after !== undefined && !isValidTimestamp(fm.stale_after)) {
    out.push({
      layer: 'okf',
      level: 'error',
      code: 'OKF_BAD_TIMESTAMP',
      path: at,
      field: 'stale_after',
      message: '`stale_after` must be ISO 8601 with an explicit offset',
    });
  }
  if (
    fm.status !== undefined &&
    !['draft', 'stable', 'deprecated'].includes(String(fm.status))
  ) {
    out.push({
      layer: 'okf',
      level: 'error',
      code: 'OKF_BAD_STATUS',
      path: at,
      field: 'status',
      message: '`status` must be one of draft | stable | deprecated',
      hint: 'Spec §5.4.',
    });
  }
  return out;
}

function checkSources(sources: unknown, at: string): Finding[] {
  if (sources === undefined) return [];
  if (!Array.isArray(sources)) {
    return [
      {
        layer: 'okf',
        level: 'error',
        code: 'OKF_BAD_SOURCES',
        path: at,
        field: 'sources',
        message: '`sources` must be a list',
      },
    ];
  }
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of (sources as OkfSource[]).entries()) {
    if (typeof entry?.resource !== 'string' || entry.resource.trim() === '') {
      out.push({
        layer: 'okf',
        level: 'error',
        code: 'OKF_SOURCE_NO_RESOURCE',
        path: at,
        field: `sources[${i}].resource`,
        message: '`resource` is required within a sources entry',
        hint: 'Spec §5.1.',
      });
    }
    if (typeof entry?.id === 'string') {
      if (seen.has(entry.id)) {
        out.push({
          layer: 'okf',
          level: 'error',
          code: 'OKF_SOURCE_DUPLICATE_ID',
          path: at,
          field: `sources[${i}].id`,
          message: `duplicate source id "${entry.id}" — footnote attribution becomes ambiguous`,
        });
      }
      seen.add(entry.id);
    }
  }
  return out;
}

export function validateProductRules(doc: OkfDocument, rules: ProductRules): Finding[] {
  if (doc.reserved) return [];
  const out: Finding[] = [];
  const at = doc.path;

  for (const field of rules.requiredFields) {
    const value = doc.data[field];
    if (value === undefined || value === null || value === '') {
      out.push({
        layer: 'product',
        level: 'error',
        code: 'PROD_MISSING_FIELD',
        path: at,
        field,
        message: `profile requires \`${field}\``,
        hint: 'This is a product rule, not an OKF conformance failure.',
      });
    }
  }

  if (rules.allowedTypes.length > 0 && typeof doc.data.type === 'string') {
    if (!rules.allowedTypes.includes(doc.data.type)) {
      out.push({
        layer: 'product',
        level: 'warning',
        code: 'PROD_UNKNOWN_TYPE',
        path: at,
        field: 'type',
        message: `type "${doc.data.type}" is outside the configured list (${rules.allowedTypes.join(', ')})`,
        hint: 'OKF tolerates unknown types; this is a house convention.',
      });
    }
  }

  if (rules.forbidSelfVerification) {
    const machineVerified = verifiedList(doc.data).filter((v) => v && !String(v.by).startsWith('human:'));
    const generatedBy = (doc.data.generated as { by?: string } | undefined)?.by;
    for (const v of machineVerified) {
      if (generatedBy && v.by === generatedBy) {
        out.push({
          layer: 'product',
          level: 'error',
          code: 'PROD_SELF_VERIFIED',
          path: at,
          field: 'verified',
          message: `"${v.by}" both generated and verified this document`,
          hint: 'A writer confirming its own output is not a verification.',
        });
      }
    }
  }

  if (rules.requireSourcesOnGenerated) {
    const generatedBy = (doc.data.generated as { by?: string } | undefined)?.by;
    const isMachine = generatedBy !== undefined && !generatedBy.startsWith('human:');
    const hasSources = Array.isArray(doc.data.sources) && doc.data.sources.length > 0;
    if (isMachine && !hasSources) {
      out.push({
        layer: 'product',
        level: 'warning',
        code: 'PROD_NO_SOURCES',
        path: at,
        field: 'sources',
        message: 'machine-generated document carries no `sources`',
      });
    }
  }

  return out;
}

export function validateDocument(
  doc: OkfDocument,
  rules: ProductRules = DEFAULT_PRODUCT_RULES,
): ValidationReport {
  const okf = validateOkfConformance(doc);
  const product = validateProductRules(doc, rules);
  return {
    findings: [...okf, ...product],
    okfConformant: !okf.some((f) => f.level === 'error'),
    productCompliant: !product.some((f) => f.level === 'error'),
  };
}

export function mergeReports(reports: readonly ValidationReport[]): ValidationReport {
  const findings = reports.flatMap((r) => r.findings);
  return {
    findings,
    okfConformant: !findings.some((f) => f.layer === 'okf' && f.level === 'error'),
    productCompliant: !findings.some((f) => f.layer === 'product' && f.level === 'error'),
  };
}

export { isReservedFilename };
