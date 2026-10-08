import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { markdownLink } from '../links/portable.js';
import { OkbError } from '../util/errors.js';
import { addressFor, type AddressInput } from './address.js';
import { rootFile, type BrainLayout } from './layout.js';
import { hubOf, subjectFoldersOf } from './tree.js';

/**
 * A fictitious work brain at the scale of real life — several products, their
 * repositories, hundreds of tickets and meetings, concepts, methods — to try
 * the organisation, the graph and the search on something big. Everything is
 * invented. It is written into an empty folder that is not a KB yet.
 */
export type DemoSize = { products: number; repos: number; tickets: number; meetings: number; concepts: number };
export const DEMO_DEFAULT: DemoSize = { products: 3, repos: 8, tickets: 200, meetings: 100, concepts: 40 };

const PRODUCTS = ['Atlas', 'Boréal', 'Cassini', 'Deneb', 'Elara'];
const PRODUCT_ABOUT = ['la facturation des contrats', 'la logistique des entrepôts', 'le portail des clients', 'le pilotage financier', 'les achats'];
const REPO_SUFFIX = ['api', 'web', 'batch', 'mobile', 'gateway'];
const THEMES = ['Facturation', 'Logistique', 'Intégration', 'Sécurité'];
const CONCEPTS = ['OData', 'OAuth 2.0', 'Idempotence', 'Webhook', 'File de messages', 'Cache', 'Pagination', 'JWT', 'CORS', 'Migration de schéma',
  'Feature flag', 'Test de contrat', 'Mock', 'Retry exponentiel', 'Circuit breaker', 'Transaction', 'Verrou optimiste', 'Index', 'Batch', 'Cron',
  'Observabilité', 'Trace distribuée', 'Log structuré', 'SLA', 'Taux de change', 'TVA', 'Avoir', 'Bon de commande', 'Réception', 'Inventaire',
  'Multi-tenant', 'Rôle', 'Habilitation', 'Environnement de recette', 'Pipeline CI', 'Revue de code', 'Branche de release', 'Hotfix', 'Rollback', 'Quota'];
const VERBS = ['corriger', 'ajouter', 'accélérer', 'simplifier', 'sécuriser', 'documenter'];
const OBJECTS = ['l’export CSV', 'le calcul de TVA', 'la pagination des commandes', 'la connexion OAuth', 'le batch de nuit', 'les droits d’accès', 'le cache des tarifs', 'le webhook de paiement'];
const MEETING_KINDS = ['Point d’équipe', 'Revue de sprint', 'Atelier d’architecture', 'Point client', 'Rétrospective'];

/** A small deterministic generator: the same demo every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export type DemoNote = { path: string; content: string };

function note(layout: BrainLayout, input: AddressInput, existing: Set<string>, front: Record<string, unknown>, body: string, brainName: string, id: string): DemoNote {
  const address = addressFor({ layout, existing, today: new Date('2026-10-06T12:00:00Z') }, input);
  existing.add(address.path);
  const crumbs = [markdownLink(address.path, rootFile(layout, 'home'), `🧠 ${brainName}`), ...subjectFoldersOf(layout, address.path).map((f) => markdownLink(address.path, hubOf(f.folder)!, f.title))];
  const data = { status: 'stable', generated: { by: 'human:demo', at: '2026-10-06T12:00:00Z' }, ...front, x_okb: { v: 1, id, brain: { type: input.type, ...(input.product ? { product: input.product } : {}), ...(input.repo ? { repo: input.repo } : {}), ...(input.theme ? { theme: input.theme } : {}) } } };
  return { path: address.path, content: `---\n${YAML.stringify(data, { lineWidth: 0 })}---\n\n🧭 ${crumbs.join(' › ')}\n\n${body.trim()}\n` };
}

export function demoNotes(layout: BrainLayout, size: DemoSize = DEMO_DEFAULT, brainName = 'Travail'): DemoNote[] {
  const r = rng(42);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const existing = new Set<string>();
  const out: DemoNote[] = [];
  let n = 0;
  const id = () => `n-demo${String(++n).padStart(5, '0')}`;
  const products = PRODUCTS.slice(0, Math.max(1, Math.min(size.products, PRODUCTS.length)));
  const repos: { product: string; name: string }[] = [];
  for (let i = 0; i < size.repos; i++) {
    const product = i === size.repos - 1 && size.repos > products.length ? 'Socle commun' : products[i % products.length]!;
    const name = product === 'Socle commun' ? 'shared-auth' : `${product.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()}-${REPO_SUFFIX[Math.floor(i / products.length) % REPO_SUFFIX.length]}`;
    repos.push({ product, name });
  }
  const conceptPaths: string[] = [];
  // Concepts first, so other notes can link to them.
  for (const c of CONCEPTS.slice(0, size.concepts)) {
    const theme = r() < 0.3 ? pick(THEMES) : undefined;
    const nn = note(layout, { type: 'concept', title: c, ...(theme ? { theme, level: 'domain' } : {}) }, existing,
      { type: 'Concept', title: c, description: `${c} expliqué en une minute.`, tags: ['concept'] },
      `# ${c}\n\n## En bref\n\n${c} : une notion fictive de démonstration, expliquée en une phrase.\n\n## Exemple\n\nUn exemple concret, inventé pour la démo.\n`, brainName, id());
    out.push(nn); conceptPaths.push(nn.path);
  }
  const linkTo = (from: string, k: number) => Array.from({ length: k }, () => pick(conceptPaths)).filter((v, i, a) => a.indexOf(v) === i).map((p) => markdownLink(from, p, p.split('/').pop()!.replace(/\.md$/, ''))).join(', ');
  for (const t of THEMES) {
    const nn = note(layout, { type: 'business-rule', title: `Règle de ${t.toLowerCase()} n°1`, theme: t, level: 'domain' }, existing,
      { type: 'Guide', title: `Règle de ${t.toLowerCase()} n°1`, description: `Une règle métier fictive du domaine ${t}.` }, `# Règle de ${t.toLowerCase()} n°1\n\n## En bref\n\nUne règle inventée qui traverse plusieurs produits.\n`, brainName, id());
    out.push(nn);
  }
  products.forEach((p, i) => {
    out.push(note(layout, { type: 'product-hub', product: p }, existing, { type: 'Overview', title: p, description: `${p} gère ${PRODUCT_ABOUT[i]}.` },
      `# ${p}\n\n## En bref\n\n${p} est un produit fictif qui gère ${PRODUCT_ABOUT[i]}.\n`, brainName, id()));
    for (const f of ['Export des données', 'Tableau de bord', 'Gestion des droits']) {
      const nn = note(layout, { type: 'feature', title: `${f}`, product: p }, existing, { type: 'Guide', title: f, description: `La fonctionnalité « ${f} » de ${p}.` }, '', brainName, id());
      nn.content = nn.content.replace(/\n$/, `# ${f}\n\n## En bref\n\nUne fonctionnalité fictive de ${p}. Voir ${linkTo(nn.path, 2)}.\n`);
      out.push(nn);
    }
    out.push(note(layout, { type: 'context', product: p }, existing, { type: 'Guide', title: `${p} — Contexte et place`, description: `Où se place ${p} parmi les autres produits.` },
      `# ${p} — Contexte et place\n\n\`\`\`mermaid\nflowchart LR\n  U[Utilisateurs] --> P[${p}]\n  P --> S[Socle commun]\n\`\`\`\n`, brainName, id()));
  });
  for (const repo of repos) {
    out.push(note(layout, { type: 'repo-hub', product: repo.product, repo: repo.name }, existing, { type: 'Overview', title: repo.name, description: `Le repo ${repo.name} en 5 minutes.` },
      `# ${repo.name}\n\n## En bref\n\nUn repo fictif du produit ${repo.product}.\n`, brainName, id()));
    for (const type of ['repo-start', 'repo-test', 'repo-debug', 'repo-codemap']) {
      out.push(note(layout, { type, product: repo.product, repo: repo.name }, existing, { type: 'Guide', title: `${repo.name} — ${type}`, description: `Note ${type} du repo ${repo.name}.` }, `# ${repo.name}\n\nContenu fictif.\n`, brainName, id()));
    }
  }
  for (let i = 1; i <= size.tickets; i++) {
    const repo = pick(repos);
    const title = `${pick(VERBS)} ${pick(OBJECTS)}`;
    const month = String(1 + Math.floor(r() * 9)).padStart(2, '0');
    const nn = note(layout, { type: 'ticket', ref: `ABC-${100 + i}`, title, product: repo.product, repo: repo.name, date: `2026-${month}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}` }, existing,
      { type: 'Experience', title: `ABC-${100 + i} — ${title}`, description: `Ticket fictif sur ${repo.name} : ${title}.`, tags: ['ticket'] }, '', brainName, id());
    nn.content = nn.content.replace(/\n$/, `# ABC-${100 + i} — ${title}\n\n## Le problème en simple\n\nUn problème inventé.\n\n## Ce que j’ai appris\n\nVoir ${linkTo(nn.path, 1)}.\n`);
    out.push(nn);
  }
  for (let i = 0; i < size.meetings; i++) {
    const day = new Date(Date.UTC(2026, 0, 5) + i * 2.7 * 86_400_000).toISOString().slice(0, 10);
    const kind = pick(MEETING_KINDS);
    out.push(note(layout, { type: 'meeting', title: `${kind} ${pick(products)}`, date: day }, existing, { type: 'Meeting', title: `${day} ${kind}`, description: `Compte rendu fictif du ${day}.` },
      `# ${kind}\n\n## Décisions\n\n- Une décision inventée.\n`, brainName, id()));
  }
  for (const m of ['Déboguer un flux en isolant chaque appel', 'Analyser un ticket avant de coder', 'Enquêter sur une lenteur']) {
    out.push(note(layout, { type: 'method', title: m }, existing, { type: 'Procedure', title: m, description: 'Une méthode réutilisable, inventée pour la démo.' }, `# ${m}\n\n1. Une étape.\n2. Une autre.\n`, brainName, id()));
  }
  out.push(note(layout, { type: 'home' }, existing, { type: 'Overview', title: brainName, description: 'Le cerveau de démonstration.' }, `# ${brainName}\n\n## En bref\n\nUn cerveau de travail fictif.\n`, brainName, id()));
  // Hub pages of every subject that has none yet (drawers, products, repositories, themes).
  const hubs = new Map<string, string>();
  for (const x of out) for (const f of subjectFoldersOf(layout, x.path)) { const h = hubOf(f.folder)!; if (!existing.has(h) && !hubs.has(h)) hubs.set(h, f.title); }
  for (const [path, title] of hubs) {
    existing.add(path);
    out.push({ path, content: `---\n${YAML.stringify({ type: 'Overview', title, description: `Page du sujet ${title}.`, status: 'stable', generated: { by: 'human:demo', at: '2026-10-06T12:00:00Z' }, x_okb: { v: 1, id: id() } }, { lineWidth: 0 })}---\n\n🧭 ${markdownLink(path, rootFile(layout, 'home'), `🧠 ${brainName}`)}\n\n# ${title}\n` });
  }
  return out;
}

export async function writeDemo(folder: string, notes: readonly DemoNote[]): Promise<number> {
  const root = resolve(folder);
  const entries = await readdir(root).catch(() => [] as string[]);
  if (entries.filter((e) => !e.startsWith('.')).length) throw new OkbError('E_CONFLICT', `${root} is not empty`, { key: 'brainDemoNotEmpty', params: { path: root } });
  for (const n of notes) {
    const abs = resolve(root, n.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, n.content);
  }
  return notes.length;
}
