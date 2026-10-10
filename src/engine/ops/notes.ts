import { z } from 'zod';
import { findNotes, recordEmpty, type FindHit, type FindResult } from '../../find/find.js';
import { loadBundleFor } from '../../kb/bundle.js';
import { scoresFor } from '../../scores/cached.js';
import { noteEvent } from '../../scores/scores.js';
import { isSecret } from '../../security/confidential.js';
import { OkbError } from '../../util/errors.js';
import { asBundlePath, type BundlePath } from '../../util/paths.js';
import { defineOperation } from '../operation.js';

const text = (max: number) => z.string().trim().min(1).max(max);

export const notesFind = defineOperation({
  id: 'notes.find',
  module: 'core',
  effect: 'read',
  summary: 'Search the notes of the knowledge base (typo-tolerant, both languages). Returns the best note, ranked hits with a snippet, related notes and facets.',
  input: z.object({
    query: text(300).describe('The words to look for, or an error message.'),
    limit: z.number().int().min(1).max(100).default(10),
    drawer: z.string().max(100).optional(),
    product: z.string().max(200).optional(),
    repo: z.string().max(200).optional(),
    type: z.string().max(200).optional().describe('One note type, or several separated by commas.'),
    status: z.enum(['draft', 'stable', 'deprecated']).optional(),
    final: z.boolean().default(false).describe('The search is finished (not a keystroke): an empty one is remembered as a gap, the first hits count as read.'),
  }).strict(),
  async run({ config, actor }, input): Promise<FindResult & { hits: (FindHit & { stars: number | null })[] }> {
    const bundle = await loadBundleFor(config);
    const scores = await scoresFor(config, bundle);
    const { query, limit, final, ...filters } = input;
    const result = findNotes(config, bundle, query, {
      ...filters,
      limit,
      scores: new Map([...scores].map(([p, s]) => [p, s.global])),
      // A 🔒 note is the person's alone: an agent's search does not show it.
      hideSecret: actor === 'agent',
    });
    if (final) {
      if (!result.hits.length) await recordEmpty(config, query);
      for (const h of result.hits.slice(0, 3)) await noteEvent(config, h.path, 'search');
    }
    return { ...result, hits: result.hits.map((h) => ({ ...h, stars: scores.get(h.path)?.stars ?? null })) };
  },
});

export const notesRead = defineOperation({
  id: 'notes.read',
  module: 'core',
  effect: 'read',
  summary: 'Read one note of the knowledge base by its path (as returned by notes.find): its title, type, description and Markdown body.',
  input: z.object({ path: text(500).describe('The note path relative to the knowledge base, e.g. "2 Produits/Billing/Overview.md".') }).strict(),
  async run({ config, actor }, input) {
    let path: BundlePath;
    try { path = asBundlePath(input.path); } catch { throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.', { key: 'noteNotFound' }); }
    const bundle = await loadBundleFor(config);
    const entry = bundle.byPath.get(path);
    const doc = bundle.docs.get(path);
    if (!entry || !doc) throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.', { key: 'noteNotFound' });
    const secret = isSecret(entry.ext);
    if (secret && actor === 'agent') throw new OkbError('E_SECRET', 'this note is 🔒: the person reads it in OKB', { key: 'secretNoteForAgent' });
    return { path, title: entry.title, type: entry.type, description: entry.description, status: entry.status, secret, body: doc.body };
  },
});
