import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { okbHome } from '../config/load.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { computeProposalHash, type Proposal } from '../proposal/model.js';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists, writeJsonAtomic } from '../util/fsx.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath } from '../util/paths.js';

/**
 * Confidentiality levels. A note marked `x_okb.confidentiality: secret` (🔒) is
 * the person's alone: Claude does not read it unless they ask for it. OKB's
 * searches leave it out of what Claude sees, the plugin's hook refuses Claude a
 * direct read of the file, and the person opens it for Claude by naming it in
 * their own message — recorded by the hook, never by a tool call, for 30 minutes.
 * The web app, the person's own screen, shows it as usual with a 🔒.
 */

export const LEVELS = ['normal', 'private', 'secret'] as const;
export type Level = (typeof LEVELS)[number];
const UNLOCK_MINUTES = 30;

export const isSecret = (ext: unknown) => (ext as { confidentiality?: unknown } | undefined)?.confidentiality === 'secret';

/** The 🔒 notes of a KB. */
export function secretNotes(bundle: Bundle): { path: string; title: string }[] {
  return bundle.entries.filter((e) => !e.reserved && isSecret(e.ext)).map((e) => ({ path: e.path as string, title: e.title }));
}

type Unlocks = { entries: { path: string; until: string }[] };
const unlockFile = (env: NodeJS.ProcessEnv) => resolve(okbHome(env), 'unlocked.json');

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The person named a 🔒 note in their own message: open it to Claude for 30
 * minutes. Called by the plugin's UserPromptSubmit hook only.
 */
export async function unlockFromPrompt(prompt: string, kbs: readonly OkbConfig[], env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<string[]> {
  const text = fold(prompt);
  const opened: string[] = [];
  for (const config of kbs) {
    const bundle = await loadBundleFor(config).catch(() => null);
    if (!bundle) continue;
    for (const n of secretNotes(bundle)) {
      const base = n.path.split('/').pop()!.replace(/\.md$/, '');
      const names = [n.title, base].map(fold).filter((x) => x.length >= 4);
      if (names.some((name) => text.includes(name))) opened.push(resolve(config.kb.root, n.path));
    }
  }
  if (!opened.length) return [];
  const until = new Date(now.getTime() + UNLOCK_MINUTES * 60_000).toISOString();
  const current = ((await readJsonIfExists<Unlocks>(unlockFile(env)).catch(() => null)) ?? { entries: [] }).entries.filter((e) => e.until > now.toISOString() && !opened.includes(e.path));
  await writeJsonAtomic(unlockFile(env), { entries: [...current, ...opened.map((path) => ({ path, until }))] });
  return opened;
}

export async function isUnlocked(absPath: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<boolean> {
  const data = await readJsonIfExists<Unlocks>(unlockFile(env)).catch(() => null);
  return Boolean(data?.entries.some((e) => e.path === absPath && e.until > now.toISOString()));
}

/** A proposal that sets a note's confidentiality (the person approves it like any change). */
export async function proposeConfidentiality(config: OkbConfig, rawPath: string, level: Level): Promise<Proposal> {
  if (!(LEVELS as readonly string[]).includes(level)) throw new OkbError('E_INVALID', `unknown level "${level}"`, { key: 'secretLevel', params: { levels: LEVELS.join(', ') } });
  const path = asBundlePath(rawPath);
  const bundle = await loadBundleFor(config);
  const doc = bundle.docs.get(path);
  const entry = bundle.byPath.get(path);
  if (!doc || !entry || entry.reserved) throw new OkbError('E_NOT_FOUND', `${path} is not a note of this KB`, { key: 'noteUnknown', params: { path } });
  const ext = { ...((doc.data.x_okb && typeof doc.data.x_okb === 'object' ? doc.data.x_okb : {}) as Record<string, unknown>) };
  if ((ext.confidentiality ?? 'normal') === level) throw new OkbError('E_CONFLICT', `${path} is already ${level}`, { key: 'secretSame', params: { path, level } });
  if (level === 'normal') delete ext.confidentiality; else ext.confidentiality = level;
  const draft = {
    id: `p-${randomUUID()}`, createdAt: new Date().toISOString(), profileId: config.profile.id, kbRoot: config.kb.root,
    sourceIds: [], sourceUris: [], baseline: { [path]: sha256(doc.raw) },
    changes: [{
      id: 'c-confidentiality', kind: 'patch-frontmatter' as const, path,
      label: `confidentiality of ${path}: ${level}`, rationale: 'level chosen by the person; the note text is unchanged',
      contentKey: sha256(`${path}:confidentiality:${level}`), evidenceIds: [], dependsOn: [], category: 'metadata' as const,
      patchFrontmatter: { patch: { x_okb: { v: 1, ...ext } } },
    }],
    evidence: [], contradictions: [], notes: [`${path}: confidentiality → ${level}`], conceptAssistLevel: 'off' as const,
  };
  return { ...draft, status: 'prepared', contentHash: computeProposalHash(draft) } as Proposal;
}

/* ------------------------------------------------------- personal data */

export type PersonalFinding = { readonly kind: 'email' | 'phone' | 'iban' | 'national-id' | 'card'; readonly line: number; readonly excerpt: string };

const PATTERNS: { kind: PersonalFinding['kind']; re: RegExp; check?: (m: string) => boolean }[] = [
  { kind: 'email', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, check: (m) => !/@(example|exemple)\.(com|org|test|fr)$/i.test(m) && !/\.(png|jpe?g|svg)$/i.test(m) },
  { kind: 'phone', re: /(?:\+\d{2}\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g },
  { kind: 'national-id', re: /\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2])\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}(?:\s?\d{2})?\b/g },
  { kind: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => luhn(m.replace(/\D/g, '')) },
];

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Personal data in a text: emails, phone numbers, IBANs, national identifiers, card numbers. Code blocks included. */
export function personalData(text: string): PersonalFinding[] {
  const out: PersonalFinding[] = [];
  text.split('\n').forEach((line, i) => {
    for (const p of PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        if (p.check && !p.check(m[0])) continue;
        const shown = m[0].length > 6 ? `${m[0].slice(0, 3)}…${m[0].slice(-2)}` : '…';
        out.push({ kind: p.kind, line: i + 1, excerpt: shown });
      }
    }
  });
  return out;
}
