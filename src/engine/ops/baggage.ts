import { z } from 'zod';
import { loadBundleFor } from '../../kb/bundle.js';
import { isSecret } from '../../security/confidential.js';
import { assertWorkSpace, baggageDraft, keepInBaggage } from '../../spaces/baggage.js';
import { baggageKb } from '../../spaces/space.js';
import { OkbError } from '../../util/errors.js';
import { asBundlePath } from '../../util/paths.js';
import { defineOperation, type OpContext } from '../operation.js';

/** An assistant never reads a 🔒 note, so it cannot carry one to the baggage either. */
async function visible(ctx: OpContext, path: string): Promise<void> {
  if (ctx.actor !== 'agent') return;
  const bundle = await loadBundleFor(ctx.config);
  let at;
  try { at = asBundlePath(path); } catch { at = null; }
  const entry = at ? bundle.byPath.get(at) : undefined;
  if (entry && isSecret(entry.ext)) throw new OkbError('E_NOT_FOUND', 'Note not found in this bundle.', { key: 'noteNotFound' });
}

export const baggageDraftOp = defineOperation({
  id: 'baggage.draft',
  module: 'core',
  effect: 'read',
  summary: 'A work note as it could go to the person’s baggage: its text without the names, references, addresses and amounts of the workplace, and what was taken out.',
  input: z.object({ path: z.string().min(1).max(500) }).strict(),
  run: async (ctx, input) => {
    assertWorkSpace(ctx.config);
    await visible(ctx, input.path);
    return baggageDraft(ctx.config, await loadBundleFor(ctx.config), input.path);
  },
});

export const baggageKeep = defineOperation({
  id: 'baggage.keep',
  module: 'core',
  effect: 'propose',
  summary: '« Garder dans mon bagage »: prepare a work note for the person’s baggage, as a proposal they approve there. A text that still names the workplace is refused.',
  input: z.object({ path: z.string().min(1).max(500), text: z.string().max(60_000).optional(), title: z.string().max(160).optional() }).strict(),
  run: async (ctx, input) => {
    assertWorkSpace(ctx.config);
    await visible(ctx, input.path);
    const baggage = await baggageKb(ctx.env);
    if (!baggage) throw new OkbError('E_NOT_FOUND', 'no baggage yet', { key: 'baggageNone', hint: 'okb init (a « career » brain), or okb settings set kb.space baggage in the brain that is yours' });
    return keepInBaggage(ctx.config, baggage, { path: input.path, ...(input.text !== undefined ? { text: input.text } : {}), ...(input.title !== undefined ? { title: input.title } : {}) });
  },
});
