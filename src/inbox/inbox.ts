import { randomBytes } from 'node:crypto';
import { readdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { assertNoSecrets } from '../security/guard.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { ensureDir, readTextIfExists, writeTextAtomic } from '../util/fsx.js';

/**
 * Capture must cost nothing, review must stay deliberate. A capture is a private
 * working file in the profile state, never a KB note: it becomes knowledge only
 * through `okb ingest`, a proposal and a human approval. Settled items are moved,
 * never deleted, so a triage decision can always be revisited.
 */
export type InboxStatus = 'open' | 'done' | 'dropped';
export type InboxItem = {
  readonly id: string;
  readonly path: string;
  readonly status: InboxStatus;
  readonly title: string;
  readonly capturedAt: string;
  readonly ageDays: number;
  readonly source?: string;
  readonly tags: readonly string[];
  readonly settledAt?: string;
  readonly proposal?: string;
  readonly reason?: string;
};

const FOLDERS: Record<InboxStatus, string> = { open: '', done: 'done', dropped: 'dropped' };

export function inboxDir(config: OkbConfig, status: InboxStatus = 'open'): string {
  return resolve(statePaths(config).root, 'inbox', FOLDERS[status]);
}

function slug(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'capture';
}

const dayMs = 86_400_000;

export async function capture(
  config: OkbConfig,
  input: { text: string; title?: string; source?: string; tags?: readonly string[]; now?: Date },
): Promise<InboxItem> {
  const text = input.text.trim();
  if (!text) throw new OkbError('E_INVALID', 'nothing to capture', { hint: 'okb capture "<text>" [--title t] [--source s] [--tag x]' });
  assertNoSecrets({ text, title: input.title, source: input.source }, 'capture');
  const now = input.now ?? new Date();
  const title = (input.title?.trim() || text.split('\n')[0]!.replace(/^#+\s*/, '')).slice(0, 120);
  const id = `i-${randomBytes(4).toString('hex')}`;
  const meta = {
    title,
    description: 'Capture brute, en attente de tri (inbox OKB).',
    x_okb_inbox: { v: 1, id, captured_at: now.toISOString(), ...(input.source ? { source: input.source } : {}), tags: [...(input.tags ?? [])] },
  };
  const dir = inboxDir(config);
  await ensureDir(dir);
  const path = resolve(dir, `${now.toISOString().slice(0, 10)}-${slug(title)}-${id}.md`);
  await writeTextAtomic(path, `---\n${YAML.stringify(meta, { lineWidth: 0 }).trimEnd()}\n---\n\n${text}\n`);
  return (await readItem(path, 'open', now))!;
}

async function readItem(path: string, status: InboxStatus, now: Date): Promise<InboxItem | null> {
  const raw = await readTextIfExists(path);
  const match = raw?.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  let data: { title?: string; x_okb_inbox?: Record<string, unknown> };
  try { data = YAML.parse(match[1]!) ?? {}; } catch { return null; }
  const m = data.x_okb_inbox;
  if (!m || typeof m.id !== 'string' || typeof m.captured_at !== 'string') return null;
  const capturedAt = m.captured_at;
  return {
    id: m.id, path, status, title: String(data.title ?? m.id), capturedAt,
    ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(capturedAt)) / dayMs)),
    ...(typeof m.source === 'string' ? { source: m.source } : {}),
    tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
    ...(typeof m.settled_at === 'string' ? { settledAt: m.settled_at } : {}),
    ...(typeof m.proposal === 'string' ? { proposal: m.proposal } : {}),
    ...(typeof m.reason === 'string' ? { reason: m.reason } : {}),
  };
}

/** Oldest first: the item that waited longest is the next one to triage. */
export async function listInbox(config: OkbConfig, options: { statuses?: readonly InboxStatus[]; now?: Date } = {}): Promise<InboxItem[]> {
  const now = options.now ?? new Date();
  const items: InboxItem[] = [];
  for (const status of options.statuses ?? ['open']) {
    const dir = inboxDir(config, status);
    let names: string[] = [];
    try { names = (await readdir(dir)).filter((n) => n.endsWith('.md')); } catch { continue; }
    for (const name of names) {
      const item = await readItem(resolve(dir, name), status, now);
      if (item) items.push(item);
    }
  }
  return items.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function findInboxItem(config: OkbConfig, idOrPrefix: string): Promise<InboxItem> {
  const all = await listInbox(config, { statuses: ['open', 'done', 'dropped'] });
  const hits = all.filter((i) => i.id === idOrPrefix || i.id.startsWith(idOrPrefix));
  if (hits.length !== 1) {
    throw new OkbError(hits.length ? 'E_INVALID' : 'E_NOT_FOUND', hits.length ? `"${idOrPrefix}" matches several inbox items` : `no inbox item "${idOrPrefix}"`, { hint: 'okb inbox --all' });
  }
  return hits[0]!;
}

/** Mark an item done (it became knowledge, or needs nothing more) or dropped. */
export async function settleInboxItem(
  config: OkbConfig,
  idOrPrefix: string,
  status: Exclude<InboxStatus, 'open'>,
  options: { proposal?: string; reason?: string; now?: Date } = {},
): Promise<InboxItem> {
  const item = await findInboxItem(config, idOrPrefix);
  if (item.status !== 'open') throw new OkbError('E_CONFLICT', `inbox item ${item.id} is already ${item.status}`);
  const now = options.now ?? new Date();
  const raw = (await readTextIfExists(item.path))!;
  const [, front, body] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)!;
  const data = YAML.parse(front!) as { x_okb_inbox: Record<string, unknown> };
  data.x_okb_inbox = { ...data.x_okb_inbox, settled_at: now.toISOString(), ...(options.proposal ? { proposal: options.proposal } : {}), ...(options.reason ? { reason: options.reason } : {}) };
  const dir = inboxDir(config, status);
  await ensureDir(dir);
  const target = resolve(dir, item.path.split('/').pop()!);
  await writeTextAtomic(item.path, `---\n${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n${body}`);
  await rename(item.path, target);
  return (await readItem(target, status, now))!;
}
