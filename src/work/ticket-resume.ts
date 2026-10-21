import { resolve } from 'node:path';
import YAML from 'yaml';
import { parseOkf, serializeOkf } from '../okf/document.js';
import { verifiedList } from '../okf/types.js';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle, type KbEntry } from '../kb/bundle.js';
import { proposeFiles } from '../proposal/files.js';
import { listProposals, saveProposal } from '../proposal/store.js';
import { repoPlace } from '../brain/products.js';
import { isBrainPlace, ticketPath } from '../repo/pack.js';
import type { RepoEntry } from '../repo/registry.js';
import { isSecret } from '../security/confidential.js';
import { assertNoSecrets } from '../security/guard.js';
import { linkProposal, requireAccepted } from '../suggest/guard.js';
import { sha256 } from '../util/hash.js';
import { listRepos } from '../repo/registry.js';
import { statePaths } from '../state/paths.js';
import { OkbError } from '../util/errors.js';
import { withStateLock } from '../util/state-lock.js';
import { addJournal, loadTicket, startTicket, syncTicket, ticketId, ticketText, titleFrom } from './tickets.js';
import { addAttempt, addCriterion, recordReuse, setTicketState, ticketDetail, updateTicketBrief, type Criterion, type Attempt } from './ticket-state.js';

export type ResumeInput = { ref: string; repo: RepoEntry; title?: string; text?: string; goal?: string; lastAction?: string; next?: string; base?: string; auto?: boolean; note?: string; suggestion?: string; context?: string; decisions?: readonly { text: string; why: string }[]; attempts?: readonly Pick<Attempt, 'approach' | 'conditions' | 'result' | 'next'>[]; criteria?: readonly Pick<Criterion, 'kind' | 'text' | 'required'>[]; sources?: readonly string[]; waiting?: { status: 'waiting' | 'blocked' | 'none'; detail: string } };
export type ResumeConflict = { field: string; kept: string; incoming: string; source: string };
const refs = (text: string) => [...text.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{0,15}[-_]\d{1,7})(?![A-Za-z0-9])/g)].map((m) => ticketId(m[1]!));

/** Identity requires an exact reference and repository context, never a substring or a body mention. */
function matchingNotes(bundle: Bundle, ref: string, repo: RepoEntry, place: Awaited<ReturnType<typeof repoPlace>>, agent: boolean): KbEntry[] {
  const prefix = isBrainPlace(place) ? `${place.folder}/${place.tickets}/` : place ? 'tickets/' : `repos/${repo.id}/tickets/`;
  return bundle.entries.filter((e) => {
    if (e.reserved || (agent && isSecret(e.ext))) return false;
    const b = e.ext.brain;
    const identity = [b?.ref, e.ext.origin, e.title, e.path.split('/').at(-1)].filter((x): x is string => typeof x === 'string');
    if (!identity.some((v) => ticketId(v) === ref || refs(v).includes(ref))) return false;
    if (b?.repo) return b.repo === repo.id;
    if (e.path.startsWith('repos/')) return e.path.startsWith(prefix);
    if (isBrainPlace(place)) return e.path.startsWith(prefix);
    return e.path.startsWith(prefix) || e.path.startsWith('tickets/');
  });
}

function section(body: string, names: readonly string[]): string | undefined {
  const chunks = body.split(/^#{1,3}\s+/m);
  for (const chunk of chunks.slice(1)) {
    const [heading, ...lines] = chunk.split('\n');
    if (names.includes(heading!.trim().toLocaleLowerCase())) {
      const text = lines.join('\n').trim();
      if (text && !/^(inconnu|unknown|à préciser|to clarify)[.!]?$/i.test(text)) return text;
    }
  }
  return undefined;
}

/** Restore operational state from known notes; knowledge itself only changes through proposals. */
export async function resumeTicket(config: OkbConfig, input: ResumeInput, options: { agent?: boolean; proposeNote?: boolean } = {}) {
  assertNoSecrets(input, 'ticket resume');
  const ref = ticketId(input.ref);
  // A separate outer lock covers reconciliation, details and proposal deduplication; journal locks remain independent.
  return withStateLock(resolve(statePaths(config).root, 'ticket-resume', ref), async () => {
    const bundle = await loadBundleFor(config);
    const place = await repoPlace(config, input.repo);
    let notes = matchingNotes(bundle, ref, input.repo, place, Boolean(options.agent));
    if (input.note) notes = notes.filter((n) => n.path === input.note);
    if ((input.note && !notes.length) || notes.length > 1) throw new OkbError('E_CONFLICT', 'choose the ticket note before reconciliation', {
      detail: { ref, repo: input.repo.id, candidates: notes.map((n) => ({ path: n.path, title: n.title })) }, hint: 'Use --note <path> to select the relevant authorized ticket note.',
    });
    // Unreadable notes may contain the missing ticket: do not silently create its duplicate.
    if (!notes.length && bundle.unreadable.some((n) => refs(n.path).includes(ref))) throw new OkbError('E_CONFLICT', 'a possible ticket note could not be read', { detail: { ref }, hint: 'Repair or inspect the unreadable note before creating another one.' });
    const note = notes[0];
    if (note && !input.note && !note.ext.brain?.repo && !note.path.startsWith(isBrainPlace(place) ? `${place.folder}/` : place ? 'tickets/' : `repos/${input.repo.id}/`) && (await listRepos()).filter((r) => r.kb === config.profile.id).length > 1) throw new OkbError('E_CONFLICT', 'the legacy note has no repository identity', { detail: { ref, repo: input.repo.id, candidates: [{ path: note.path, title: note.title }] }, hint: 'Confirm the intended note with --note <path>.' });
    const body = note ? bundle.docs.get(note.path)!.body : '';
    const before = await loadTicket(config, ref);
    const existingText = before ? await ticketText(before) : null;
    const conflicts: ResumeConflict[] = [];
    const title = input.title || (note ? titleFrom(note.title, ref) ?? note.title : undefined);
    if (before && title && before.title !== ref && !before.auto && before.title !== title) conflicts.push({ field: 'title', kept: before.title, incoming: title, source: input.title ? 'input' : note!.path });
    if (existingText && input.text?.trim() && existingText.trim() !== input.text.trim()) conflicts.push({ field: 'text', kept: existingText.trim(), incoming: input.text.trim(), source: 'input' });
    const started = await startTicket(config, { ...input, ref, ...(title ? { title } : {}) });
    if (input.text?.trim() && existingText && existingText.trim() !== input.text.trim()) await addJournal(config, ref, { kind: 'note', text: input.text.trim(), repo: input.repo.id });
    if (input.context) await addJournal(config, ref, { kind: 'note', text: input.context, repo: input.repo.id });
    for (const decision of input.decisions ?? []) await addJournal(config, ref, { kind: 'decision', text: `${decision.text} — ${decision.why}`, repo: input.repo.id });
    for (const source of input.sources ?? []) await addJournal(config, ref, { kind: 'note', text: `Source: ${source}`, repo: input.repo.id });
    const detail = await ticketDetail(config, ref);
    for (const attempt of input.attempts ?? []) if (!detail.detail.attempts.some((a) => a.approach === attempt.approach && a.conditions === attempt.conditions && a.result === attempt.result && a.next === attempt.next)) await addAttempt(config, ref, attempt);
    for (const criterion of input.criteria ?? []) if (!detail.detail.criteria.some((c) => c.kind === criterion.kind && c.text === criterion.text)) await addCriterion(config, ref, criterion);
    if (note && !detail.detail.reuses.some((r) => r.path === note.path && r.sha256 === note.sha256)) await recordReuse(config, ref, bundle, { path: note.path, why: 'Ticket reconciliation source' }, options.agent ? 'agent' : 'person');
    if (input.waiting) {
      const old = detail.detail.states.find((s) => s.dimension === 'waiting');
      if (!old || old.status === 'unknown') await setTicketState(config, ref, { dimension: 'waiting', ...input.waiting }, options.agent ? 'agent' : 'person');
      else if (old.status !== input.waiting.status || old.detail !== input.waiting.detail) conflicts.push({ field: 'waiting', kept: `${old.status}: ${old.detail}`, incoming: `${input.waiting.status}: ${input.waiting.detail}`, source: 'input' });
    }
    const patch: { goal?: string; lastAction?: string; next?: string } = {};
    const incoming = {
      goal: input.goal ?? section(body, ['objectif', 'goal']),
      lastAction: input.lastAction ?? section(body, ['dernière action', 'last action']),
      next: input.next ?? section(body, ['prochaine étape', 'next step']),
    };
    for (const field of ['goal', 'lastAction', 'next'] as const) {
      const value = incoming[field];
      if (!value) continue;
      const kept = detail.detail[field];
      if (!kept) patch[field] = value.slice(0, field === 'next' ? 600 : 1000);
      else if (kept !== value) conflicts.push({ field, kept, incoming: value, source: input[field] ? 'input' : note!.path });
    }
    if (Object.keys(patch).length) await updateTicketBrief(config, ref, patch, options.agent ? 'agent' : 'person');
    const synced = await syncTicket(config, (await loadTicket(config, ref))!, [input.repo]);
    const final = await ticketDetail(config, ref);
    if (options.agent) final.detail.reuses = final.detail.reuses.filter((r) => { const entry = bundle.byPath.get(r.path as never); return Boolean(entry && !isSecret(entry.ext)); });
    let proposal: { id: string; status: string; reused: boolean } | null = null;
    let proposalDeferred: { reason: string; path: string } | null = null;
    const saveReviewable = async (path: string, content: string, label: string) => {
      const prior = (await listProposals(config)).find((p) => p.notes.includes(label));
      if (prior) { proposal = { id: prior.id, status: prior.status, reused: true }; return; }
      let accepted;
      try { accepted = await requireAccepted(config, path, input.suggestion, options.agent); }
      catch (error) { if (error instanceof OkbError && error.code === 'E_NOT_APPROVED') { proposalDeferred = { reason: error.key ?? 'suggestion-required', path }; return; } throw error; }
      const p = proposeFiles(config, bundle, new Map([[path, content]]), label);
      await saveProposal(config, p);
      await linkProposal(config, accepted, p.id);
      proposal = { id: p.id, status: p.status, reused: false };
    };
    if (!note && options.proposeNote !== false) {
      // The initial skeleton is stable across retries and later corrections. Existing proposals, including dismissed ones, are never recreated.
      const path = ticketPath(input.repo.id, ref, new Date(started.record.startedAt), place);
      const prior = (await listProposals(config)).find((p) => p.notes.includes(`ticket-resume:${ref}:${input.repo.id}`));
      if (prior) proposal = { id: prior.id, status: prior.status, reused: true };
      else {
        const fields = [['Objectif', final.detail.goal], ['Contexte utile', input.context || input.text], ['Dernière action', final.detail.lastAction], ['Décisions et raisons', final.ticket.journal.filter((j) => j.kind === 'decision').map((j) => `- ${j.text}`).join('\n')], ['Essais ratés et conditions', final.detail.attempts.map((a) => `- ${a.approach} ; ${a.conditions} → ${a.result}`).join('\n')], ['Blocage / attente', input.waiting ? `${input.waiting.status}: ${input.waiting.detail}` : ''], ['Prochaine étape', final.detail.next], ['Critères de fin', final.detail.criteria.filter((c) => c.text !== c.kind).map((c) => `- ${c.text} (${c.status})`).join('\n')]];
        const content = `---\n${YAML.stringify({ title: `${ref} — ${final.ticket.title}`, type: 'note', description: `Reprise déclarative du ticket ${ref} dans ${input.repo.name}.`, status: 'draft', generated: { by: config.okf.machineActor, at: started.record.startedAt }, 'x_okb': { origin: ref, tickets: [ref], confidence: 'heard', brain: { type: 'ticket', ref, repo: input.repo.id } } })}---\n# ${ref} — ${final.ticket.title}\n\n${fields.map(([h, v]) => `## ${h}\n\n${v?.trim() || 'Inconnu.'}`).join('\n\n')}\n\n## Sources\n\n- Suivi local : ${ref}, repo ${input.repo.id}. Informations déclarées ; Git ne confirme ni CI ni livraison.\n${(input.sources ?? []).map((source) => `- ${source}`).join('\n')}\n`;
        // Never replace an occupied path: it may be a human note without recognizable identity.
        if (bundle.snapshot.files.has(path)) throw new OkbError('E_CONFLICT', 'the ticket note destination is already occupied', { detail: { path } });
        await saveReviewable(path, content, `ticket-resume:${ref}:${input.repo.id}`);
      }
    }
    if (note && options.proposeNote !== false) {
      const facts = { ...(input.title ? { title: input.title } : {}), ...(input.text ? { text: input.text } : {}), ...(input.goal ? { goal: input.goal } : {}), ...(input.lastAction ? { lastAction: input.lastAction } : {}), ...(input.next ? { next: input.next } : {}), ...(input.context ? { context: input.context } : {}), ...(input.decisions?.length ? { decisions: input.decisions } : {}), ...(input.attempts?.length ? { attempts: input.attempts } : {}), ...(input.criteria?.length ? { criteria: input.criteria } : {}), ...(input.sources?.length ? { sources: input.sources } : {}), ...(input.waiting ? { waiting: input.waiting } : {}) };
      const key = sha256(JSON.stringify(facts));
      const marker = `<!-- okb:ticket-resume:${key} -->`;
      const raw = bundle.snapshot.files.get(note.path)!;
      if (Object.keys(facts).length && !raw.includes(marker)) {
        const labels: Record<string, string> = { title: 'Titre proposé', text: 'Texte fourni', goal: 'Objectif', lastAction: 'Dernière action', next: 'Prochaine étape', context: 'Contexte utile', decisions: 'Décisions et raisons', attempts: 'Essais ratés et conditions', criteria: 'Critères de fin', sources: 'Sources', waiting: 'Blocage / attente' };
        const lines = Object.entries(facts).map(([field, value]) => {
          let text: string;
          if (typeof value === 'string') text = value;
          else if (field === 'decisions') text = input.decisions!.map((d) => `- ${d.text} — ${d.why}`).join('\n');
          else if (field === 'attempts') text = input.attempts!.map((a) => `- ${a.approach} ; ${a.conditions} → ${a.result}${a.next ? ` ; suite : ${a.next}` : ''}`).join('\n');
          else if (field === 'criteria') text = input.criteria!.map((c) => `- ${c.text}${c.required ? ' (obligatoire)' : ''} — inconnu`).join('\n');
          else if (field === 'sources') text = input.sources!.map((source) => `- ${source}`).join('\n');
          else text = `${input.waiting!.status === 'blocked' ? 'Bloqué' : input.waiting!.status === 'waiting' ? 'En attente' : 'Aucune attente déclarée'} : ${input.waiting!.detail}`;
          return `### ${labels[field]}\n\n${text}`;
        });
        const conflictsText = conflicts.length ? `\nValeurs contradictoires à relire : ${conflicts.map((c) => c.field).join(', ')}. Les formulations humaines au-dessus sont conservées.\n` : '';
        let content = `${raw.replace(/\n?$/, '\n')}\n## Reprise proposée — ${ref}\n\n${marker}\n\nInformations déclarées pendant la reprise ; à relire avec leurs sources.\n\n${lines.join('\n\n')}${conflictsText}\n`;
        const beforeDoc = bundle.docs.get(note.path)!;
        const verified = verifiedList(beforeDoc.data);
        const oldExtension = beforeDoc.data.x_okb && typeof beforeDoc.data.x_okb === 'object' ? beforeDoc.data.x_okb as Record<string, unknown> : {};
        content = serializeOkf(parseOkf(note.path, content), { ...beforeDoc.data, status: 'draft', ...(verified.length ? { verified: [], x_okb: { ...oldExtension, prior_verified: [...(Array.isArray(oldExtension.prior_verified) ? oldExtension.prior_verified : []), ...verified] } } : {}) });
        await saveReviewable(note.path, content, `ticket-resume:${ref}:${input.repo.id}:${key}`);
      }
    }
    return { ...final, proposalDeferred: proposalDeferred as { reason: string; path: string } | null, created: started.created, attached: started.attached, notes: notes.map((n) => ({ path: n.path, title: n.title, sha256: n.sha256 })), conflicts, proposal, progress: synced.progress, unknowns: ['pr', 'checks', 'delivery'].filter((d) => final.detail.states.some((s) => s.dimension === d && s.status === 'unknown')) };
  });
}
