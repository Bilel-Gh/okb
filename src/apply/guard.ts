import type { OkbConfig } from '../config/schema.js';
import { sha256 } from '../util/hash.js';
import { readTextIfExists } from '../util/fsx.js';
import { assertInsideRoot, bundlePathToAbsolute, matchesAny, type BundlePath } from '../util/paths.js';
import { OkbError } from '../util/errors.js';
import type { Change, Proposal } from '../proposal/model.js';

export type GuardViolation = {
  readonly code: 'E_FORBIDDEN_PATH' | 'E_STALE' | 'E_CONFLICT';
  readonly path: string;
  readonly message: string;
  readonly hint?: string;
};

export type GuardReport = {
  readonly ok: boolean;
  readonly violations: readonly GuardViolation[];
  readonly checkedPaths: readonly BundlePath[];
};

/** Deny wins over allow; a path must be explicitly allowed and not denied. */
export function checkPathPolicy(config: OkbConfig, path: BundlePath): GuardViolation | null {
  if (matchesAny(path, config.kb.exclude)) {
    return {
      code: 'E_FORBIDDEN_PATH',
      path,
      message: `"${path}" is excluded from the bundle by kb.exclude`,
      hint: `excluded: ${config.kb.exclude.join(', ')}`,
    };
  }
  if (matchesAny(path, config.policy.writeDeny)) {
    return {
      code: 'E_FORBIDDEN_PATH',
      path,
      message: `"${path}" matches policy.writeDeny`,
      hint: `deny list: ${config.policy.writeDeny.join(', ')}`,
    };
  }
  if (!matchesAny(path, config.policy.writeAllow) || config.policy.writeAllowGroups.some(group => !matchesAny(path, group))) {
    return {
      code: 'E_FORBIDDEN_PATH',
      path,
      message: `"${path}" is not covered by policy.writeAllow`,
      hint: `allow list: ${config.policy.writeAllow.join(', ')}`,
    };
  }
  return null;
}

/**
 * Everything checked before a single byte is written: path policy, symlink
 * escapes, file count, and — the one that matters most — whether the files still
 * look like they did when the proposal was prepared.
 */
export async function guardApply(
  config: OkbConfig,
  proposal: Proposal,
  changes: readonly Change[],
  options: { alreadyWritten?: ReadonlyMap<string, string> } = {},
): Promise<GuardReport> {
  const violations: GuardViolation[] = [];
  const paths = [...new Set(changes.map((c) => c.path))];
  const alreadyWritten = options.alreadyWritten ?? new Map<string, string>();

  if (paths.length > config.policy.maxApplyFiles) {
    violations.push({
      code: 'E_CONFLICT',
      path: '(proposal)',
      message: `${paths.length} files exceed policy.maxApplyFiles (${config.policy.maxApplyFiles})`,
    });
  }

  for (const path of paths) {
    const policyViolation = checkPathPolicy(config, path);
    if (policyViolation) {
      violations.push(policyViolation);
      continue;
    }

    try {
      await assertInsideRoot(config.kb.root, path);
    } catch (error) {
      violations.push({
        code: 'E_FORBIDDEN_PATH',
        path,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const current = await readTextIfExists(bundlePathToAbsolute(config.kb.root, path));
    const currentHash = current === null ? null : sha256(current);

    // On resume, a file this run already wrote must match what the journal
    // recorded — not the pre-run baseline it deliberately moved away from.
    const journaled = alreadyWritten.get(path);
    if (journaled !== undefined) {
      if (currentHash !== journaled) {
        violations.push({
          code: 'E_CONFLICT',
          path,
          message: 'this run already wrote the file and it has changed again since',
          hint: 'Roll back the receipt, then re-prepare the proposal.',
        });
      }
      continue;
    }

    const expected = path in proposal.baseline ? proposal.baseline[path]! : undefined;

    if (expected === undefined) {
      violations.push({
        code: 'E_CONFLICT',
        path,
        message: 'the proposal records no baseline for this path',
      });
      continue;
    }
    if (currentHash !== expected) {
      violations.push({
        code: 'E_STALE',
        path,
        message:
          expected === null
            ? 'the file did not exist when the proposal was prepared but exists now'
            : current === null
              ? 'the file existed when the proposal was prepared and is now missing'
              : 'the file changed since the proposal was prepared',
        hint: 'Re-run `okb ingest --reprocess <source>` to rebuild against the current tree.',
      });
    }
  }

  return { ok: violations.length === 0, violations, checkedPaths: paths };
}

export function assertGuard(report: GuardReport): void {
  if (report.ok) return;
  const first = report.violations[0]!;
  throw new OkbError(first.code, `${report.violations.length} guard violation(s); first: ${first.message}`, {
    detail: { violations: report.violations },
    hint: first.hint ?? 'Nothing was written.',
  });
}
