import { z } from 'zod';
import { defineOperation, type OpContext } from '../engine/operation.js';
import { URL_ROLES, type UrlRole } from '../repo/url-kinds.js';
import { OkbError } from '../util/errors.js';
import { classifyHost, linkKey, parseKey, resetOverride, resolveArchConflict, writeOverride } from './overrides.js';
import { systemOf } from './system.js';

/**
 * The person's corrections of the system map, as engine operations (F2.4-17,
 * D72): the app, `okb arch link …` and MCP share them. Excluding, putting back,
 * classifying an address and settling a conflict are the person's own acts.
 */
const KINDS = ['http', 'event', 'package', 'service', 'data', 'external'] as const;
const key = z.string().trim().min(5).max(600).refine((k) => parseKey(k) !== null, 'a link key is kind|from|to');
const target = z.string().trim().regex(/^(repo:[\w.@/-]{1,150}|ext:[a-z0-9.-]{3,253})$/i, 'a target is repo:<name> or ext:<host>');
const reason = z.string().trim().max(300).default('');
const origin = (ctx: OpContext) => (ctx.actor === 'person' ? 'person' as const : 'agent' as const);

/** A repository target must be one of this KB's mapped repositories. */
async function known(ctx: OpContext, id: string): Promise<void> {
  if (!id.startsWith('repo:')) return;
  const sys = await systemOf(ctx.config);
  if (!sys?.maps.some((m) => `repo:${m.repo.name}` === id)) throw new OkbError('E_INVALID', `${id} is not a mapped repository of this knowledge base`, { key: 'archTargetUnknown', params: { target: id } });
}

export const archMap = defineOperation({
  id: 'arch.map', module: 'dev', effect: 'read',
  summary: 'How the repositories connect, corrections included: each link with its kind, proofs, certainty (proved, declared, supposed, confirmed) and reason; what is kept off the map; excluded links and conflicts.',
  input: z.object({}).strict(),
  run: async (ctx) => {
    const sys = await systemOf(ctx.config);
    if (!sys) return { system: null };
    const { model, name } = sys;
    return {
      system: name,
      links: model.links.map((l) => ({ key: linkKey(l.kind, l.from, l.to), from: l.from, to: l.to, kind: l.kind, certainty: l.certainty ?? null, basis: l.basis ?? null, origin: l.origin ?? 'scan', calls: l.calls.map((c) => c.what), evidence: l.evidence })),
      offMap: model.offMap ?? [], excluded: (model.excluded ?? []).map((l) => ({ key: linkKey(l.kind, l.from, l.to), reason: l.reason, at: l.at })),
      stale: model.stale ?? [], conflicts: model.conflicts ?? [], questions: model.questions,
    };
  },
});
export const archLinkConfirm = defineOperation({
  id: 'arch.link.confirm', module: 'dev', effect: 'state', summary: 'Confirm a link of the system map. The person’s word is never replaced; an agent confirming keeps the agent as origin.',
  input: z.object({ key, reason }).strict(),
  run: async (ctx, i) => writeOverride(ctx.config, { key: i.key, action: 'confirm', target: null, kind: null, what: null, reason: i.reason, origin: origin(ctx) }),
});
export const archLinkExclude = defineOperation({
  id: 'arch.link.exclude', module: 'dev', effect: 'state', agents: false, summary: 'Take a wrong link off the map, with a short reason; it stays listed and can be put back. Respected by every next scan.',
  input: z.object({ key, reason: z.string().trim().min(1).max(300) }).strict(),
  run: async (ctx, i) => writeOverride(ctx.config, { key: i.key, action: 'exclude', target: null, kind: null, what: null, reason: i.reason, origin: 'person' }),
});
export const archLinkRetarget = defineOperation({
  id: 'arch.link.retarget', module: 'dev', effect: 'state', summary: 'Say what a link really goes to (another repository, or an outside resource). Facing the person’s correction, a different answer becomes a conflict.',
  input: z.object({ key, target, reason }).strict(),
  run: async (ctx, i) => { await known(ctx, i.target); return writeOverride(ctx.config, { key: i.key, action: 'retarget', target: i.target, kind: null, what: null, reason: i.reason, origin: origin(ctx) }); },
});
export const archLinkAdd = defineOperation({
  id: 'arch.link.add', module: 'dev', effect: 'state', summary: 'Write a link the code does not show (from a repository to a repository or an outside resource), with what passes on it and why.',
  input: z.object({ from: target, to: target, kind: z.enum(KINDS), what: z.string().trim().max(200).optional(), reason }).strict(),
  run: async (ctx, i) => {
    if (!i.from.startsWith('repo:')) throw new OkbError('E_INVALID', 'a link starts from a repository', { key: 'archTargetUnknown', params: { target: i.from } });
    await known(ctx, i.from); await known(ctx, i.to);
    return writeOverride(ctx.config, { key: linkKey(i.kind, i.from, i.to), action: 'add', target: i.to, kind: i.kind, what: i.what ?? null, reason: i.reason, origin: origin(ctx) });
  },
});
export const archLinkReset = defineOperation({
  id: 'arch.link.reset', module: 'dev', effect: 'state', agents: false, summary: 'Undo a correction of the map: the link is again what the scans say.',
  input: z.object({ key }).strict(),
  run: async (ctx, i) => { resetOverride(ctx.config, i.key); return { ok: true }; },
});
export const archUrlClassify = defineOperation({
  id: 'arch.url.classify', module: 'dev', effect: 'state', agents: false, summary: 'Say once what an address is (outside resource, registry, documentation, platform…), for every repository; null forgets the rule.',
  input: z.object({ host: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]{3,253}$/), role: z.enum(URL_ROLES as [UrlRole, ...UrlRole[]]).nullable() }).strict(),
  run: async (ctx, i) => { classifyHost(ctx.config, i.host, i.role); return { ok: true }; },
});
export const archConflictResolve = defineOperation({
  id: 'arch.conflict.resolve', module: 'dev', effect: 'state', agents: false, summary: 'Settle what an agent said differently: keep your correction, or take the agent’s.',
  input: z.object({ key, keep: z.enum(['mine', 'agent']) }).strict(),
  run: async (ctx, i) => {
    if (!resolveArchConflict(ctx.config, i.key, i.keep)) throw new OkbError('E_NOT_FOUND', 'no conflict on this link', { key: 'archConflictUnknown' });
    return { ok: true };
  },
});
