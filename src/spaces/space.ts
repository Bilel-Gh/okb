import { loadConfig } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { listKbs, readRootConfig, type KbSummary } from '../kb/registry.js';

/**
 * Two spaces that never mix (F2.0-12). « Mon bagage » is what belongs to the
 * person and follows them: skills, methods, lessons. « Travail » is one
 * employer's or one client's projects, notes and documents. Each brain is in
 * one of them. The only bridge is « Garder dans mon bagage »
 * (src/spaces/baggage.ts), which takes nothing of the workplace along.
 */
export const SPACES = ['baggage', 'work'] as const;
export type Space = (typeof SPACES)[number];

/** What the person said for this brain; else a career brain is the baggage and any other is work — the strict side. */
export function spaceOf(config: { readonly kb: { readonly space?: Space | undefined; readonly brain?: { readonly preset: string } | undefined } }): Space {
  return config.kb.space ?? (config.kb.brain?.preset === 'career' ? 'baggage' : 'work');
}

export type SpaceKb = KbSummary & { readonly space: Space };

/** Every brain with its space. A brain whose settings cannot be read is treated as work. */
export async function kbsWithSpace(env: NodeJS.ProcessEnv = process.env): Promise<SpaceKb[]> {
  return Promise.all((await listKbs(env)).map(async (k) => ({ ...k, space: await loadConfig({ env, profileId: k.id }).then((r) => spaceOf(r.config), (): Space => 'work') })));
}

/** The spaces with their brains, the baggage first: what the person picks from at the top of every screen. */
export async function listSpaces(env: NodeJS.ProcessEnv = process.env): Promise<{ id: Space; kbs: SpaceKb[] }[]> {
  const kbs = await kbsWithSpace(env);
  return SPACES.map((id) => ({ id, kbs: kbs.filter((k) => k.space === id) }));
}

/** The brain « Garder dans mon bagage » fills: the one the person named (`baggage.kb`), else their first baggage brain. */
export async function baggageKb(env: NodeJS.ProcessEnv = process.env): Promise<OkbConfig | null> {
  const named = ((await readRootConfig(env).catch(() => ({}))) as { baggage?: { kb?: unknown } }).baggage?.kb;
  const candidates = (await kbsWithSpace(env)).filter((k) => k.space === 'baggage' && k.exists);
  const chosen = candidates.find((k) => k.id === named) ?? candidates[0];
  return chosen ? (await loadConfig({ env, profileId: chosen.id })).config : null;
}
