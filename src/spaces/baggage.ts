import { posix } from 'node:path';
import YAML from 'yaml';
import { addressFor } from '../brain/address.js';
import { layoutOf } from '../brain/layout.js';
import { noteKind, noteType } from '../brain/types.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { proposeFiles } from '../proposal/files.js';
import { computeProposalHash } from '../proposal/model.js';
import { listProposals, saveProposal } from '../proposal/store.js';
import { assertNoSecrets } from '../security/guard.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath } from '../util/paths.js';
import { detailsIn, withoutDetails, workplaceNames, type Detail } from './details.js';
import { spaceOf } from './space.js';

/**
 * « Garder dans mon bagage » (F2.0-12): a lesson learned at work, kept for
 * life without anything of the workplace. OKB prepares a first version without
 * AI — names, references, addresses and amounts give way to neutral words —
 * the person rereads or rewrites it, and it reaches the baggage as a proposal
 * they approve there. A version that still names the workplace is refused.
 */
export type BaggageDraft = { readonly title: string; readonly description: string; readonly type: string; readonly text: string; readonly removed: readonly Detail[] };

const langOf = (config: OkbConfig): 'fr' | 'en' => ((config.writing.language ?? config.profile.answer.language).toLowerCase().startsWith('fr') ? 'fr' : 'en');

function source(bundle: Bundle, path: string) {
  let at;
  try { at = asBundlePath(path); } catch { at = null; }
  const entry = at ? bundle.byPath.get(at) : undefined;
  const doc = at ? bundle.docs.get(at) : undefined;
  if (!entry || !doc || entry.reserved) throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.', { key: 'noteNotFound' });
  return { entry, doc };
}

/** Every mention of the workplace in a text of this brain. */
export async function internalDetails(config: OkbConfig, bundle: Bundle, text: string, extraWords: readonly string[] = []): Promise<Detail[]> {
  return detailsIn(text, await workplaceNames(config, bundle, extraWords));
}

/** The note as it could go to the baggage: its text without the workplace, and what was taken out. */
export async function baggageDraft(config: OkbConfig, bundle: Bundle, path: string): Promise<BaggageDraft> {
  const { entry, doc } = source(bundle, path);
  const names = await workplaceNames(config, bundle);
  const lang = langOf(config);
  const body = doc.body.replace(/^\s+/, '');
  return {
    title: withoutDetails(entry.title, names, lang),
    description: withoutDetails(entry.description, names, lang),
    type: noteKind(entry) ?? 'experience',
    text: `${withoutDetails(body, names, lang).replace(/\n{3,}/g, '\n\n').trim()}\n`,
    removed: detailsIn(body, names),
  };
}

export type Kept = { readonly proposal: string; readonly kb: string; readonly target: string; readonly title: string; readonly removed: number };

/**
 * Prepare the note for the baggage. Nothing is written: the person approves
 * the proposal in their baggage. The note that goes carries no path, no id and
 * no source of the work brain — only that it came from work, and when.
 */
export async function keepInBaggage(work: OkbConfig, baggage: OkbConfig, input: { readonly path: string; readonly text?: string; readonly title?: string }, now = new Date()): Promise<Kept> {
  const bundle = await loadBundleFor(work);
  const { doc } = source(bundle, input.path);
  const draft = await baggageDraft(work, bundle, input.path);
  const body = input.text?.trim() ? `${input.text.trim()}\n` : draft.text;
  const title = (input.title?.trim() || (input.text ? /^#\s+(.+)$/m.exec(input.text)?.[1]?.trim() : '') || draft.title).slice(0, 160);
  const layout = layoutOf(baggage);
  // A kind of note that only exists at work (a repository's page, a ticket) becomes a lesson learned.
  const kind = noteType(draft.type);
  const type = kind && (!layout || !kind.presets || kind.presets.includes(layout.preset)) ? kind.id : 'experience';
  const there = await loadBundleFor(baggage);
  const target = layout
    ? addressFor({ layout, existing: new Set(there.snapshot.files.keys()), today: now }, { type, title }).path
    : asBundlePath(posix.join('Bagage', `${title.replace(/[\\/:*?"<>|]/g, ' ').trim()}.md`));
  const front = {
    type: String((doc.data as { type?: unknown }).type ?? 'Reference'), title,
    ...(draft.description ? { description: draft.description } : {}),
    status: 'draft',
    // Rewritten by the person, it is theirs; else it keeps who wrote the lesson.
    generated: { by: input.text?.trim() ? baggage.profile.humanActor : String((doc.data as { generated?: { by?: unknown } }).generated?.by ?? baggage.profile.humanActor), at: now.toISOString() },
    x_okb: { v: 1, brain: { type }, origin: { space: 'work', kept: now.toISOString().slice(0, 10) } },
  };
  const content = `---\n${YAML.stringify(front, { lineWidth: 0 })}---\n\n${body}`;
  assertNoSecrets({ content }, 'baggage note');
  const left = await internalDetails(work, bundle, content);
  if (left.length) {
    throw new OkbError('E_INVALID', `${left.length} mention(s) of the workplace would go to the baggage`, { key: 'baggageDetails', params: { count: String(left.length), list: [...new Set(left.map((d) => d.text))].slice(0, 6).join(', ') }, detail: { details: left.slice(0, 50) } });
  }
  if (there.snapshot.files.has(target) || (await listProposals(baggage)).some((p) => p.status === 'prepared' && p.changes.some((c) => c.path === target))) {
    throw new OkbError('E_CONFLICT', 'the baggage already has, or is about to have, a note of this name', { key: 'baggageExists', params: { title } });
  }
  const files = proposeFiles(baggage, there, new Map([[target, content]]), `keep in my baggage: ${title}`);
  // It is a note to read, not a mechanical change: the list of what waits names it by its title.
  const { contentHash: _hash, status: _status, ...rest } = {
    ...files,
    changes: files.changes.map((c) => ({ ...c, category: 'article' as const, rationale: 'a lesson from work, without anything of the workplace; reread it before approving' })),
  };
  const proposal = { ...rest, status: 'prepared' as const, contentHash: computeProposalHash(rest) };
  await saveProposal(baggage, proposal);
  return { proposal: proposal.id, kb: baggage.profile.id, target, title, removed: draft.removed.length };
}

/** The checks before any note is read: a baggage keeps nothing from itself, and there must be a baggage to fill. */
export function assertWorkSpace(config: OkbConfig): void {
  if (spaceOf(config) === 'baggage') throw new OkbError('E_INVALID', 'this brain is already your baggage', { key: 'baggageAlready' });
}
