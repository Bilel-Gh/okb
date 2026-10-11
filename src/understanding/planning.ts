import type { OkbConfig } from '../config/schema.js';
import { findNotes } from '../find/find.js';
import { loadBundleFor } from '../kb/bundle.js';
import { collectCards, dueCards, listObjectives, reviewLog, skillsMap } from '../learn/learn.js';
import { listActions } from '../projects/actions.js';
import { getProject } from '../projects/projects.js';
import { isSecret } from '../security/confidential.js';
import { OkbError } from '../util/errors.js';
import { asBundlePath } from '../util/paths.js';
import { understandingOverview, UNDERSTANDING_LIMITS } from './state.js';
import type { UnderstandingSource } from './reading.js';

export type MeetingInput = { projectId?: string; query?: string };
export type MeetingBrief = {
  project: { id: string; title: string; where: string; next: string } | null;
  known: { path: string; title: string; description: string; sources: UnderstandingSource[] }[];
  open: { id: string; text: string; kind: string; source: string }[];
  questions: { text: string; source: { kind: 'action' | 'debt' | 'note'; id: string; path?: string } }[];
  limitations: readonly string[];
};

/** F2.2-07: a bounded, source-preserving meeting brief works without an agent. */
export async function prepareMeeting(config: OkbConfig, input: MeetingInput, env: NodeJS.ProcessEnv = process.env): Promise<MeetingBrief> {
  const query = input.query?.trim() ?? '';
  if (!input.projectId && !query) throw new OkbError('E_INVALID', 'Choose a project or the subject of the meeting.');
  const project = input.projectId ? getProject(config, input.projectId) : null;
  const bundle = await loadBundleFor(config);
  const inScope = (path: string) => !project?.folder || path.startsWith(`${project.folder.replace(/\/$/, '')}/`);
  const eligible = bundle.entries.filter((e) => !e.reserved && !isSecret(e.ext) && inScope(e.path));
  const ranked = query ? findNotes(config, bundle, query, { hideSecret: true, limit: 100 }).hits.map((h) => String(h.path)) : null;
  // No project folder and no subject means there is no demonstrated link from notes to this meeting.
  const selected = ranked ? eligible.filter((e) => ranked.includes(e.path)).sort((a, b) => ranked.indexOf(a.path) - ranked.indexOf(b.path)).slice(0, 12)
    : project?.folder ? eligible.slice(0, 12) : [];
  const known = selected.map((e) => {
    const body = bundle.docs.get(e.path)!.body;
    const quote = body.split('\n').find((l) => l.trim() && !/^\s*(?:#|```|~~~|>)/.test(l))?.trim().slice(0, 500) ?? '';
    return { path: String(e.path), title: e.title, description: e.description, sources: quote ? [{ path: String(e.path), title: e.title, hash: e.sha256, quote }] : [] };
  });
  const actions = project ? await listActions(config, env, { project: project.id, status: 'open' }) : [];
  const open = actions.map((a) => ({ id: a.id, text: a.text, kind: a.kind, source: a.source }));
  const questions: MeetingBrief['questions'] = actions.filter((a) => a.kind === 'question').map((a) => ({ text: a.text, source: { kind: 'action', id: a.id } }));
  const selectedPaths = new Set(selected.map((e) => String(e.path)));
  for (const d of (await understandingOverview(config)).debts) if (selectedPaths.has(d.path)) {
    questions.push({ text: d.point || `Que faut-il savoir expliquer sur « ${d.subject} » ?`, source: { kind: 'debt', id: d.id, path: d.path } });
  }
  for (const e of selected) {
    // Only explicit question lines: no invented guesses of what colleagues will ask.
    const lines = bundle.docs.get(e.path)!.body.split('\n').filter((l) => l.trim().endsWith('?') && !/^\s*#/.test(l)).slice(0, 3);
    for (const text of lines) questions.push({ text: text.trim().replace(/^[-*]\s*/, ''), source: { kind: 'note', id: e.path, path: e.path } });
  }
  const unique = new Map(questions.map((q) => [`${q.source.kind}|${q.source.id}|${q.text}`, q]));
  return {
    project: project ? { id: project.id, title: project.title, where: project.where, next: project.next } : null,
    known, open, questions: [...unique.values()].slice(0, 30),
    limitations: [...UNDERSTANDING_LIMITS, 'La préparation rassemble les notes reliées au projet ou retrouvées par recherche, et les questions enregistrées ; elle ne garantit pas de prévoir les questions de la réunion.', ...(project && !project.folder && !query ? ['Aucun dossier de notes ni sujet de recherche n’est relié à ce projet.'] : [])],
  };
}

export type LearningInput = { subject?: string; path?: string };

/** F2.2-09: the existing FSRS schedule and chosen objectives, with small actionable paths. */
export async function understandingLearning(config: OkbConfig, input: LearningInput, now = new Date()) {
  const bundle = await loadBundleFor(config);
  const [review, objectives, mastery, overview, history] = await Promise.all([
    dueCards(config, bundle, { now, ...(input.subject ? { subject: input.subject } : {}), ...(input.path ? { note: input.path } : {}) }),
    listObjectives(config), skillsMap(config, bundle), understandingOverview(config, now),
    reviewLog(config),
  ]);
  const levels = new Map(overview.subjects.map((s) => [s.path, s.level]));
  const cards = collectCards(config, bundle);
  const pathways = objectives.filter((o) => !input.subject || o.subject === input.subject).map((o) => {
    const studied = new Set(history.filter((r) => r.at.slice(0, 10) >= o.createdAt).map((r) => r.id));
    const chosen = o.subject ? cards.filter((c) => c.subject === o.subject).map((c) => c.path) : [];
    const searched = findNotes(config, bundle, o.text, { hideSecret: true, limit: 5 }).hits.map((h) => String(h.path));
    const paths = [...new Set([...chosen, ...searched])].filter((p) => !input.path || p === input.path).slice(0, 5);
    const steps = paths.flatMap((path) => {
      const e = bundle.byPath.get(asBundlePath(path))!;
      const level = levels.get(path);
      return [
        { kind: 'consult' as const, path, title: e.title, done: level !== null && level !== undefined && level !== 'encountered' },
        { kind: 'explain' as const, path, title: e.title, done: level === 'explained' || level === 'reused' },
        { kind: 'review' as const, path, title: e.title, done: cards.some((c) => c.path === path && studied.has(c.id)) },
        { kind: 'reuse' as const, path, title: e.title, done: level === 'reused' },
      ];
    });
    return { id: o.id, text: o.text, subject: o.subject, by: o.by, doneAt: o.doneAt, steps };
  });
  return { review, objectives, pathways, mastery, limitations: [...UNDERSTANDING_LIMITS, 'Les cartes gardent leur planification FSRS. Les étapes sont proposées à partir de l’objectif et des notes présentes, sans évaluation automatique de la pratique.'] };
}
