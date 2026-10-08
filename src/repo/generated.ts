import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import type { OkbConfig } from '../config/schema.js';
import { loadBundleFor, type Bundle } from '../kb/bundle.js';
import { markdownLink } from '../links/portable.js';
import { proposeFiles } from '../proposal/files.js';
import type { Proposal } from '../proposal/model.js';
import { pick } from '../templates/registry.js';
import { sha256 } from '../util/hash.js';
import { asBundlePath, type BundlePath } from '../util/paths.js';
import { gitIdentity } from './git.js';
import { repoContext, repoNotes, type RepoContext } from './notes.js';
import { isFlat, notePath, noteDescription, noteTitle, REPOS_FOLDER } from './pack.js';
import { repoPlace } from '../brain/products.js';
import { drawerFolder, layoutOf } from '../brain/layout.js';
import { QUESTIONS, THEMES } from './questions.js';
import { listRepos, type RepoEntry } from './registry.js';
import { coverageOf, repoStatus } from './status.js';
import { loadMap, loadProgress, repoPaths } from './state.js';
import type { Iface, RepoMap, Risk } from './types.js';

const isFr = (lang: string) => lang.toLowerCase().startsWith('fr');

/** A risk in plain words, in the note's language. */
export function riskText(r: Risk, lang: string): string {
  const fr = isFr(lang);
  const p = r.params ?? {};
  switch (r.kind) {
    case 'doc-drift':
      if (p.code === 'script') return fr ? `\`${p.doc}\` (l.${p.line}) dit \`${p.said}\`, mais aucun package.json ne déclare de script « ${p.name} ».` : `\`${p.doc}\` (l.${p.line}) says \`${p.said}\`, but no package.json declares a "${p.name}" script.`;
      if (p.code === 'make') return fr ? `\`${p.doc}\` (l.${p.line}) dit \`${p.said}\`, mais le Makefile n’a pas cette cible.` : `\`${p.doc}\` (l.${p.line}) says \`${p.said}\`, but the Makefile has no such target.`;
      if (p.code === 'path') return fr ? `\`${p.doc}\` (l.${p.line}) mentionne \`${p.said}\`, absent du repo.` : `\`${p.doc}\` (l.${p.line}) mentions \`${p.said}\`, which is not in the repository.`;
      return r.detail;
    case 'secret-like': return fr ? `Valeur qui ressemble à un secret (${p.what}) dans \`${p.file}\` l.${p.line} : la valeur n’a pas été copiée.` : `Secret-like value (${p.what}) in \`${p.file}\` l.${p.line}: the value was not copied.`;
    case 'tracked-env': return fr ? `\`${p.file}\` est présent et non ignoré par Git : il peut contenir des identifiants (ses valeurs ne sont jamais lues).` : `\`${p.file}\` is present and not ignored by Git: it may hold credentials (its values are never read).`;
    case 'todo': return fr ? `${p.count} TODO/FIXME dans \`${p.file}\`.` : `${p.count} TODO/FIXME in \`${p.file}\`.`;
    case 'large-file': return fr ? `\`${p.file}\` fait ${p.lines} lignes.` : `\`${p.file}\` has ${p.lines} lines.`;
    case 'thin-readme': return fr ? `Le README racine ne fait que ${p.lines} lignes.` : `The root README has only ${p.lines} lines.`;
    case 'no-readme': return fr ? 'Pas de README à la racine du repo.' : 'No README at the root of the repository.';
    case 'no-tests': return fr ? 'Aucun fichier de test automatisé trouvé.' : 'No automated test file found.';
    case 'no-ci': return fr ? 'Aucun pipeline CI/CD trouvé.' : 'No CI/CD pipeline found.';
  }
}

/** CODEOWNERS pattern → regular expression (GitHub semantics, simplified). */
function ownerPattern(pattern: string): RegExp {
  const anchored = pattern.startsWith('/');
  const dir = pattern.endsWith('/');
  const body = pattern.replace(/^\//, '').replace(/\/$/, '').split('**').map((part) => part.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  const prefix = anchored || body.includes('/') ? '^' : '(^|/)';
  return new RegExp(`${prefix}${body}${dir ? '/' : '(/|$)'}`);
}

/** Who may know about these files: CODEOWNERS first (last matching rule wins), then who changed the area most. */
export function askWho(map: RepoMap, files: readonly string[], lang: string): string | null {
  const fr = isFr(lang);
  const owners = new Set<string>();
  for (const file of files.length ? files : ['README.md']) {
    let match: readonly string[] | null = null;
    for (const rule of map.ownership.codeowners) if (rule.pattern === '*' || ownerPattern(rule.pattern).test(file)) match = rule.owners;
    for (const o of match ?? []) owners.add(o);
  }
  const areas = new Set(files.map((f) => (f.includes('/') ? f.split('/')[0]! : '.')));
  const authors = new Set<string>();
  for (const m of map.modules) if (areas.has(m.path)) for (const a of m.authors.slice(0, 2)) authors.add(a);
  if (!authors.size) for (const a of map.ownership.authors.slice(0, 2)) authors.add(a.name);
  const parts: string[] = [];
  if (owners.size) parts.push(`${[...owners].slice(0, 3).join(', ')} (CODEOWNERS)`);
  if (authors.size) parts.push(`${[...authors].slice(0, 3).join(', ')} (${fr ? 'historique Git' : 'Git history'})`);
  return parts.length ? parts.join(' · ') : null;
}

function frontmatter(config: OkbConfig, data: Record<string, unknown>): string {
  return `---\n${YAML.stringify({ ...data, status: 'draft', generated: { by: config.okf.machineActor, at: new Date().toISOString() } }, { lineWidth: 0 })}---\n`;
}

/* ------------------------------------------------------ open questions */

export async function questionsNote(ctx: RepoContext, bundle?: Bundle): Promise<{ path: BundlePath; content: string }> {
  const { config, repo, paths } = ctx;
  const lang = config.writing.language ?? config.profile.answer.language;
  const fr = isFr(lang);
  const map = await loadMap(paths);
  if (!map) throw new Error('scan first');
  const kb = bundle ?? (await loadBundleFor(config));
  const status = await repoStatus(ctx, { bundle: kb });
  const progress = await loadProgress(paths);
  const path = notePath(repo.id, 'questions', lang, await repoPlace(config, repo));
  const mapBytes = await readFile(paths.map);
  const identity = await gitIdentity(repo.path);
  const counts = { done: 0, pending: 0, received: 0, unknown: 0, open: 0, found: 0 };
  for (const q of status.questions) {
    if (q.state === 'answered') counts.done++;
    else counts[q.state]++;
  }
  const lines: string[] = [
    '> [!NOTE]',
    fr
      ? `> Ce que la KB ne sait pas encore sur **${repo.name}**, où OKB a cherché, et à qui demander. Note générée par \`okb repo questions --propose\` ; une réponse s’enregistre avec \`okb repo answer\`.`
      : `> What the KB does not know yet about **${repo.name}**, where OKB looked, and whom to ask. Generated by \`okb repo questions --propose\`; record an answer with \`okb repo answer\`.`,
    '',
    fr
      ? `**En bref** : ${counts.done} questions sur ${QUESTIONS.length} couvertes par une note · ${counts.pending} en attente de ta relecture · ${counts.received} réponses reçues à intégrer · ${counts.unknown} sans réponse dans le repo · ${counts.open + counts.found} pas encore traitées.`
      : `**In short**: ${counts.done} of ${QUESTIONS.length} questions covered by a note · ${counts.pending} awaiting your review · ${counts.received} answers received to integrate · ${counts.unknown} not answered by the repository · ${counts.open + counts.found} not handled yet.`,
    '',
  ];
  const stateLabel: Record<string, string> = fr
    ? { answered: '✅ couverte', pending: '🕓 en relecture', received: '📨 réponse reçue', found: '🔎 éléments trouvés', unknown: '❓ inconnue', open: '⬜ pas encore traitée' }
    : { answered: '✅ covered', pending: '🕓 in review', received: '📨 answer received', found: '🔎 material found', unknown: '❓ unknown', open: '⬜ not handled yet' };
  for (const theme of THEMES) {
    lines.push(`## ${theme.emoji} ${pick(theme.label, lang)}`, '');
    lines.push(fr ? '| Question | État | Où chercher · à qui demander |' : '| Question | State | Where to look · whom to ask |', '|---|---|---|');
    for (const q of QUESTIONS.filter((x) => x.theme === theme.id)) {
      const view = status.questions.find((v) => v.id === q.id)!;
      const hint = map.questions.find((h) => h.id === q.id);
      const where = view.note && (view.state === 'answered' || view.state === 'pending')
        ? markdownLink(path, view.note, kb.byPath.get(view.note as BundlePath)?.title ?? view.note.split('/').pop()!)
        : [
          ...(view.looked?.length ? [`${fr ? 'cherché dans' : 'looked in'} ${view.looked.slice(0, 3).map((f) => `\`${f}\``).join(', ')}`] : hint?.hints.length ? [hint.hints.slice(0, 3).map((h) => `\`${h.file}${h.line > 1 ? `:${h.line}` : ''}\``).join(', ')] : []),
          view.askWho ?? askWho(map, (view.looked?.length ? view.looked : hint?.hints.map((h) => h.file)) ?? [], lang) ?? '',
        ].filter(Boolean).join(' · ');
      const why = view.state === 'unknown' && view.why ? `<br>${escapeCell(view.why)}` : '';
      lines.push(`| ${escapeCell(pick(q.text, lang))} | ${stateLabel[view.state]}${why} | ${escapeCell(where)} |`);
    }
    lines.push('');
  }
  const drift = map.risks.filter((r) => r.kind === 'doc-drift');
  if (drift.length) {
    lines.push(`## 📄 ${fr ? 'La doc et le code divergent' : 'Docs and code disagree'}`, '');
    lines.push(fr ? 'Une divergence est une raison de demander, pas la preuve que la doc a tort.' : 'A disagreement is a reason to ask, not proof the docs are wrong.', '');
    for (const r of drift) lines.push(`- ${riskText(r, lang)}`);
    lines.push('');
  }
  const coverage = coverageOf(map, progress);
  lines.push(`## 🔎 ${fr ? 'Ce qui a été lu, et ce qui ne l’a pas été' : 'What was read, and what was not'}`, '');
  lines.push(fr
    ? `- Lecture prioritaire (doc, manifestes, interfaces, points d’entrée) : ${coverage.readFiles}/${coverage.readTotal} fichiers lus.`
    : `- Priority reading (docs, manifests, interfaces, entry points): ${coverage.readFiles}/${coverage.readTotal} files read.`);
  lines.push(fr
    ? `- Code central ou très modifié : ${coverage.skimFiles}/${coverage.skimTotal} fichiers parcourus.`
    : `- Central or busy code: ${coverage.skimFiles}/${coverage.skimTotal} files skimmed.`);
  lines.push(fr ? `- ${map.plan.indexed} fichiers seulement indexés (repérés, pas lus).` : `- ${map.plan.indexed} files only indexed (located, not read).`);
  for (const s of map.files.skipped.slice(0, 5)) lines.push(`- ${s.count} ${fr ? 'ignorés' : 'skipped'} : ${s.reason} (${s.examples.map((e) => `\`${e}\``).join(', ')})`);
  lines.push('');
  const content = frontmatter(config, {
    type: 'Reference',
    title: noteTitle('questions', repo.name, lang),
    description: noteDescription('questions', repo.name, lang),
    tags: ['repo', repo.id, 'questions'],
    sources: [{ id: `scan-${sha256(mapBytes).slice(0, 10)}`, resource: `urn:sha256:${sha256(mapBytes)}`, title: `${repo.name} — ${fr ? 'carte du repo' : 'repository map'} (okb repo scan, ${map.repo.head?.slice(0, 10) ?? '—'})` }],
    x_okb: { v: 1, repo: { id: repo.id, kind: 'questions', commit: identity.head } },
  }) + `\n${lines.join('\n').trimEnd()}\n`;
  return { path, content };
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export async function proposeQuestionsNote(ctx: RepoContext): Promise<Proposal> {
  const bundle = await loadBundleFor(ctx.config);
  const { path, content } = await questionsNote(ctx, bundle);
  const before = bundle.snapshot.files.get(path);
  // Keep the note's creation date when only the generation time would change.
  return proposeFiles(ctx.config, bundle, new Map([[path, before && stripGenerated(before) === stripGenerated(content) ? before : content]]), isFr(ctx.config.writing.language ?? ctx.config.profile.answer.language) ? `questions ouvertes de ${ctx.repo.name}` : `open questions of ${ctx.repo.name}`);
}

function stripGenerated(text: string): string {
  return text.replace(/^ {2}at: .*$/m, '');
}

/* ----------------------------------------------------------- landscape */

export type Edge = { readonly from: string; readonly to: string; readonly label: string; readonly evidence: readonly string[] };

const norm = (s: string) => s.toLowerCase().replace(/service$/i, '').replace(/[^a-z0-9]+/g, '');

/**
 * How the repositories of one KB relate: an API one declares and another
 * consumes, a library one publishes and another depends on, an event one emits
 * and another listens to. Only matches between declarations; never inferred
 * from names alone beyond that.
 */
export function landscapeEdges(maps: readonly RepoMap[]): { edges: Edge[]; external: Map<string, Set<string>> } {
  const edges: Edge[] = [];
  const external = new Map<string, Set<string>>();
  const where = (m: RepoMap, i: Iface) => `${m.repo.name}:${i.evidence.file}:${i.evidence.line}`;
  for (const a of maps) {
    for (const c of a.consumes) {
      if (c.kind === 'url' && c.detail === 'local') continue;
      let matched = false;
      for (const b of maps) {
        if (b === a) continue;
        if (c.kind === 'package' && (b.published ?? []).some((p) => p.name === c.name)) {
          edges.push({ from: a.repo.id, to: b.repo.id, label: `npm ${c.name}`, evidence: [where(a, c)] });
          matched = true;
          continue;
        }
        if (c.kind === 'event') {
          const p = b.provides.find((x) => x.kind === 'event' && x.name === c.name);
          if (p) { edges.push({ from: b.repo.id, to: a.repo.id, label: `event ${c.name}`, evidence: [where(b, p), where(a, c)] }); matched = true; }
          continue;
        }
        const target = b.provides.find((p) => (['cds-service', 'service-binding', 'ui-app', 'odata', 'openapi', 'grpc'].includes(p.kind) && (norm(p.name) === norm(c.name) || (p.detail?.startsWith('path ') && c.kind === 'odata' && c.name.replace(/\/$/, '').endsWith(p.detail.slice(5).replace(/\/$/, ''))))));
        if (target && ['external-service', 'destination', 'odata', 'service-binding'].includes(c.kind)) {
          edges.push({ from: a.repo.id, to: b.repo.id, label: `${c.kind} ${c.name}`, evidence: [where(a, c), where(b, target)] });
          matched = true;
        }
      }
      if (!matched && ['external-service', 'destination', 'url', 'database', 'messaging'].includes(c.kind)) {
        const set = external.get(a.repo.id) ?? new Set<string>();
        set.add(`${c.kind} ${c.name}`);
        external.set(a.repo.id, set);
      }
    }
  }
  const seen = new Set<string>();
  return { edges: edges.filter((e) => { const k = `${e.from}>${e.to}>${e.label}`; if (seen.has(k)) return false; seen.add(k); return true; }), external };
}

export async function landscapeNote(config: OkbConfig): Promise<{ path: BundlePath; content: string; repos: RepoEntry[]; edges: Edge[] } | null> {
  const lang = config.writing.language ?? config.profile.answer.language;
  const fr = isFr(lang);
  const repos = (await listRepos()).filter((r) => r.kb === config.profile.id);
  const maps: RepoMap[] = [];
  for (const r of repos) {
    const map = await loadMap(repoPaths(config, r.id));
    if (map) maps.push(map);
  }
  // A repository KB has no landscape: its connections show in the workspace it is attached to.
  if (!maps.length || isFlat(config)) return null;
  const bundle = await loadBundleFor(config);
  const layout = layoutOf(config);
  // In a brain, the landscape of the repositories belongs to the world around them.
  const path = layout
    ? asBundlePath(`${drawerFolder(layout, 'world')}/${layout.lang === 'fr' ? 'Paysage des repos' : 'Repository landscape'}.md`)
    : asBundlePath(`${REPOS_FOLDER}/${fr ? 'paysage.md' : 'landscape.md'}`);
  const places = new Map<string, Awaited<ReturnType<typeof repoPlace>>>();
  for (const m of maps) places.set(m.repo.id, await repoPlace(config, repos.find((r) => r.id === m.repo.id) ?? { id: m.repo.id, name: m.repo.name }));
  const { edges, external } = landscapeEdges(maps);
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const mermaid = ['flowchart LR'];
  for (const m of maps) mermaid.push(`  ${id(m.repo.id)}["${m.repo.name.replace(/"/g, "'")}"]`);
  for (const e of edges) mermaid.push(`  ${id(e.from)} -->|${e.label.replace(/[|"]/g, ' ').slice(0, 40)}| ${id(e.to)}`);
  let n = 0;
  for (const [from, set] of external) for (const label of [...set].slice(0, 6)) {
    const node = `x${n++}`;
    mermaid.push(`  ${node}(["${label.replace(/"/g, "'").slice(0, 40)}"])`, `  ${id(from)} -.-> ${node}`);
  }
  const lines = [
    '> [!NOTE]',
    fr
      ? `> Comment les ${maps.length} repos de cette KB se parlent, d’après ce que chacun déclare (API, destinations, paquets, événements). Note générée par \`okb repo landscape --propose\`. Un lien absent n’est pas la preuve qu’il n’existe pas.`
      : `> How the ${maps.length} repositories of this KB talk to each other, from what each declares (APIs, destinations, packages, events). Generated by \`okb repo landscape --propose\`. A missing link is not proof there is none.`,
    '',
    `## 🗺️ ${fr ? 'La carte' : 'The map'}`,
    '',
    '```mermaid',
    ...mermaid,
    '```',
    '',
    `## 📚 ${fr ? 'Les repos' : 'The repositories'}`,
    '',
    fr ? '| Repo | À quoi il sert | Stack | Notes |' : '| Repository | What it is for | Stack | Notes |',
    '|---|---|---|---|',
  ];
  for (const m of maps) {
    const overview = notePath(m.repo.id, 'overview', lang, places.get(m.repo.id));
    const notes = repoNotes(bundle, m.repo.id, places.get(m.repo.id));
    const link = bundle.byPath.has(overview) ? markdownLink(path, overview, noteTitle('overview', m.repo.name, lang)) : (fr ? 'pas encore de note' : 'no note yet');
    lines.push(`| ${m.repo.name} | ${escapeCell(m.repo.description ?? '—')} | ${escapeCell(m.stack.slice(0, 3).map((s) => s.label).join(', '))} | ${link}${notes.length > 1 ? ` (+${notes.length - 1})` : ''} |`);
  }
  lines.push('');
  if (edges.length) {
    lines.push(`## 🔗 ${fr ? 'Les liens trouvés' : 'Links found'}`, '');
    for (const e of edges) lines.push(`- **${e.from}** → **${e.to}** : ${e.label} (${e.evidence.map((x) => `\`${x}\``).join(fr ? ' et ' : ' and ')})`);
    lines.push('');
  }
  const content = frontmatter(config, {
    type: 'Reference',
    title: fr ? 'Paysage des repos' : 'Repository landscape',
    description: fr ? 'Les repos documentés dans cette KB et ce qui les relie, d’après leurs déclarations.' : 'The repositories documented in this KB and what connects them, from their declarations.',
    tags: ['repo', 'landscape'],
    sources: maps.map((m) => ({ id: `scan-${m.repo.id}-${(m.repo.head ?? 'none').slice(0, 10)}`, resource: `urn:okb-repo-scan:${m.repo.id}:${m.repo.head ?? 'none'}`, title: `${m.repo.name} — ${fr ? 'carte du repo' : 'repository map'} (okb repo scan, ${m.repo.head?.slice(0, 10) ?? '—'})` })),
    x_okb: { v: 1, repo: { id: '*', kind: 'landscape' } },
  }) + `\n${lines.join('\n').trimEnd()}\n`;
  return { path, content, repos, edges };
}

export async function proposeLandscape(config: OkbConfig): Promise<Proposal | null> {
  const note = await landscapeNote(config);
  if (!note) return null;
  const bundle = await loadBundleFor(config);
  const before = bundle.snapshot.files.get(note.path);
  return proposeFiles(config, bundle, new Map([[note.path, before && stripGenerated(before) === stripGenerated(note.content) ? before : note.content]]), isFr(config.writing.language ?? config.profile.answer.language) ? 'paysage des repos' : 'repository landscape');
}

export { repoContext };
