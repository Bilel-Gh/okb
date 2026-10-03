import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { checkLinks, snapshotFromEntries } from '../links/check.js';
import { parseOkf } from '../okf/document.js';
import { validateDocument } from '../okf/validate.js';
import { OkbError } from '../util/errors.js';
import type { BundlePath } from '../util/paths.js';
import { findSecrets } from '../security/secrets.js';
import { secretError } from '../security/guard.js';

/** Reject new structural problems, while allowing repair of an imperfect legacy KB. */
export async function validatePlannedFiles(config: OkbConfig, desired: ReadonlyMap<string, { before: string | null; after: string | null }>): Promise<void> {
  const bundle = await loadBundleFor(config);
  const snapshot = new Map(bundle.snapshot.files);
  for (const [path, { before, after }] of desired) {
    if (after === null) { snapshot.delete(path as BundlePath); continue; }
    snapshot.set(path as BundlePath, after);
    const known = new Set(findSecrets(before ?? '').map((f) => f.masked));
    const added = findSecrets(after).filter((f) => !known.has(f.masked));
    if (added.length) throw secretError(added.map((f) => ({ ...f, at: `${path}:${f.line}` })), 'proposal');
    if (!path.endsWith('.md')) continue;
    const next = parseOkf(path, after);
    const issues = validateDocument(next, config.okf.productRules).findings;
    const previous = before === null ? [] : validateDocument(parseOkf(path, before), config.okf.productRules).findings;
    const introduced = issues.filter(i => i.level === 'error' && !previous.some(p => p.code === i.code && p.field === i.field));
    if (introduced.length) throw new OkbError('E_INVALID', `proposed document violates structural rules: ${path}`, { detail: { findings: introduced } });
    if (before === null && next.data.verified !== undefined) throw new OkbError('E_INVALID', 'new generated documents cannot claim technical verification');
  }
  const key = (x: { file: string; code: string; url: string }) => JSON.stringify([x.file, x.code, x.url]);
  const previousLinks = new Set(checkLinks(bundle.snapshot, { brokenTargetsAre: 'error' }).issues.map(key));
  const broken = checkLinks(snapshotFromEntries(snapshot), { brokenTargetsAre: 'error' }).issues.filter(i => !previousLinks.has(key(i)));
  if (broken.length) throw new OkbError('E_INVALID', 'proposal introduces broken or non-portable links', { detail: { issues: broken } });
}
