import { randomUUID } from 'node:crypto';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor } from '../kb/bundle.js';
import { computeProposalHash, type Proposal } from '../proposal/model.js';
import { loadTemplates } from '../templates/registry.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';
import { categorise, loadCategories, templateCategories } from './categories.js';

/**
 * Put a note in a category by hand: a proposal that writes `x_okb.category`
 * (or removes it with `auto`, so the template, type or folder decides again).
 * Like every change to the KB, it waits for the person's approval.
 */
export async function proposeCategory(config: OkbConfig, rawPath: string, category: string): Promise<Proposal> {
  const path = asBundlePath(rawPath);
  const [bundle, categories, templates] = await Promise.all([loadBundleFor(config), loadCategories(config), loadTemplates(config)]);
  const doc = bundle.docs.get(path);
  const entry = bundle.byPath.get(path);
  if (!doc || !entry || entry.reserved) throw new OkbError('E_NOT_FOUND', `${path} is not a note of this KB`, { key: 'noteUnknown', params: { path } });
  const auto = category === 'auto';
  if (!auto && !categories.some((c) => c.id === category)) {
    throw new OkbError('E_INVALID', `unknown category "${category}"`, { key: 'categoryUnknown', params: { id: category, ids: categories.map((c) => c.id).join(', ') } });
  }
  const ext = { ...((doc.data.x_okb && typeof doc.data.x_okb === 'object' ? doc.data.x_okb : {}) as Record<string, unknown>) };
  const before = categorise({ path, type: entry.type, template: ext.template, explicit: ext.category }, categories, templateCategories(templates));
  if ((auto && ext.category === undefined) || (!auto && ext.category === category)) {
    throw new OkbError('E_CONFLICT', `${path} is already in this category`, { key: 'categorySame', params: { path, id: before.category } });
  }
  if (auto) delete ext.category;
  else ext.category = category;
  const draft = {
    id: `p-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    profileId: config.profile.id,
    kbRoot: config.kb.root,
    sourceIds: [],
    sourceUris: [],
    baseline: { [path]: sha256(doc.raw) },
    changes: [{
      id: 'c-category', kind: 'patch-frontmatter' as const, path,
      label: auto ? `category of ${path}: back to automatic` : `category of ${path}: ${before.category} → ${category}`,
      rationale: 'classification chosen by the person; the note text is unchanged',
      contentKey: sha256(`${path}:category:${auto ? 'auto' : category}`), evidenceIds: [], dependsOn: [], category: 'metadata' as const,
      patchFrontmatter: { patch: { x_okb: { v: 1, ...ext } } },
    }],
    evidence: [], contradictions: [],
    notes: [auto ? `${path}: category back to automatic (template, type or folder)` : `${path}: category ${before.category} → ${category}`],
    conceptAssistLevel: 'off',
  };
  return { ...draft, status: 'prepared', contentHash: computeProposalHash(draft) };
}
