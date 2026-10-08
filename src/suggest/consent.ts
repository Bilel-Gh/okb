import { resolve } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import { statePaths } from '../state/paths.js';
import { appendLine, readLines } from '../util/fsx.js';

/**
 * The person's yes to a suggestion, recorded by OKB's hooks from what the
 * person did — a button they clicked in Claude's question, a short « oui »
 * right after a card, a suggestion id they typed — never by Claude itself:
 * the approval guard refuses any Bash command that names this file or the
 * hook's command. A yes counts for 30 minutes.
 */
export type Consent = { readonly at: string; readonly ids: readonly string[]; readonly via: 'question' | 'prompt'; readonly any?: boolean };

const VALID_MS = 30 * 60_000;

export function consentFile(config: OkbConfig): string {
  return resolve(statePaths(config).root, 'suggest', 'consent.jsonl');
}

export async function readConsents(config: OkbConfig, now = new Date()): Promise<Consent[]> {
  const rows = await readLines(consentFile(config)).catch(() => [] as string[]);
  const out: Consent[] = [];
  for (const r of rows) {
    try {
      const c = JSON.parse(r) as Consent;
      if (now.getTime() - Date.parse(c.at) <= VALID_MS) out.push(c);
    } catch { /* cut line */ }
  }
  return out;
}

/** Whether the person said yes to this suggestion (or to « the card just shown »). */
export async function hasConsent(config: OkbConfig, id: string, shownAt: string | undefined, now = new Date()): Promise<boolean> {
  for (const c of await readConsents(config, now)) {
    if (c.ids.includes(id)) return true;
    // A bare « oui » answers the card shown just before it.
    if (c.any && shownAt && Date.parse(c.at) >= Date.parse(shownAt) && Date.parse(c.at) - Date.parse(shownAt) < 15 * 60_000) return true;
  }
  return false;
}

/** Written by the hooks only. */
export async function recordConsent(config: OkbConfig, consent: Consent): Promise<void> {
  await appendLine(consentFile(config), JSON.stringify(consent));
}

/** Suggestion ids in a text: `S-1a2b3c`. */
export function idsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\bS-[0-9a-f]{6}\b/gi)].map((m) => `S-${m[0].slice(2).toLowerCase()}`))];
}

const YES = /^\s*(oui|yes|ok(ay)?|d['’]accord|vas[- ]y|go|crée[- ]?la|cree[- ]?la|garde[- ]?(la|le|ça|les)?|écris[- ]?la|ajoute[- ]?la|create( it)?|keep( it)?|write( it)?|sure|yep|ouais)\b/i;

/** A short, plain yes: « oui », « ok vas-y », « garde-la ». */
export function isPlainYes(text: string): boolean {
  return text.trim().length <= 60 && YES.test(text) && !/\b(non|no|pas|not|plus tard|later)\b/i.test(text);
}

const ACCEPT_LABEL = /^(créer|compléter|garder|écrire|ajouter|oui|create|complete|keep|write|add|yes)\b/i;

/** From an AskUserQuestion result: the suggestion ids of the options the person picked to accept. */
export function idsFromQuestion(toolInput: unknown, toolResponse: unknown): { ids: string[]; any: boolean } {
  const ids = new Set<string>();
  let any = false;
  const questions = (toolInput as { questions?: { question?: string; options?: { label?: string; description?: string }[] }[] } | undefined)?.questions ?? [];
  // The labels the person picked: the values of an `answers` map (keyed by question), never the question texts.
  const picked: string[] = [];
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const answers = (v as { answers?: unknown }).answers;
    if (answers && typeof answers === 'object') for (const a of Object.values(answers as Record<string, unknown>)) picked.push(...(Array.isArray(a) ? a.map(String) : String(a).split(/,\s*/)));
    for (const x of Object.values(v as Record<string, unknown>)) if (x && typeof x === 'object') visit(x);
  };
  visit(toolInput);
  visit(toolResponse);
  if (!picked.length && typeof toolResponse === 'string') {
    let text = toolResponse;
    for (const q of questions) if (q.question) text = text.split(q.question).join(' ');
    picked.push(text);
  }
  const answersText = picked.join('\n');
  for (const q of questions) {
    for (const o of q.options ?? []) {
      const label = String(o.label ?? '');
      if (!label || !answersText.includes(label)) continue;
      // An option that is itself a card (a multi-select list of suggestions): picking it is the yes.
      const own = idsIn(`${label} ${o.description ?? ''}`);
      if (own.length) { for (const id of own) ids.add(id); continue; }
      // « Créer », « Garder »… for the card the question is about (or the one just shown).
      if (!ACCEPT_LABEL.test(label)) continue;
      const asked = idsIn(q.question ?? '');
      if (asked.length) for (const id of asked) ids.add(id);
      else any = true;
    }
  }
  return { ids: [...ids], any };
}
