/**
 * A small French ↔ English lexicon for search: work notes mix both languages
 * (French prose, English code and product names). Searching « facture » also
 * finds « invoice ». Common work words only; a brain's own words come from the
 * aliases of its notes.
 */
const PAIRS: readonly (readonly [string, string])[] = [
  ['facture', 'invoice'], ['facturation', 'billing'], ['commande', 'order'], ['client', 'customer'], ['fournisseur', 'supplier'],
  ['livraison', 'delivery'], ['paiement', 'payment'], ['utilisateur', 'user'], ['droit', 'permission'], ['habilitation', 'authorization'],
  ['rôle', 'role'], ['déploiement', 'deployment'], ['déployer', 'deploy'], ['erreur', 'error'], ['panne', 'outage'], ['connexion', 'login'],
  ['authentification', 'authentication'], ['jeton', 'token'], ['mot de passe', 'password'], ['base de données', 'database'], ['table', 'table'],
  ['requête', 'query'], ['réponse', 'response'], ['demande', 'request'], ['serveur', 'server'], ['service', 'service'], ['tâche', 'task'],
  ['ticket', 'ticket'], ['anomalie', 'bug'], ['correctif', 'fix'], ['test', 'test'], ['recette', 'acceptance'], ['environnement', 'environment'],
  ['production', 'production'], ['configuration', 'configuration'], ['paramétrage', 'configuration'], ['fichier', 'file'], ['dossier', 'folder'],
  ['journal', 'log'], ['trace', 'trace'], ['surveillance', 'monitoring'], ['alerte', 'alert'], ['sauvegarde', 'backup'], ['restauration', 'restore'],
  ['mise à jour', 'update'], ['version', 'version'], ['branche', 'branch'], ['fusion', 'merge'], ['revue de code', 'code review'],
  ['tableau de bord', 'dashboard'], ['rapport', 'report'], ['budget', 'budget'], ['marge', 'margin'], ['coût', 'cost'], ['prix', 'price'],
  ['tarif', 'pricing'], ['taxe', 'tax'], ['TVA', 'VAT'], ['avoir', 'credit note'], ['stock', 'inventory'], ['entrepôt', 'warehouse'],
  ['achat', 'purchase'], ['vente', 'sale'], ['contrat', 'contract'], ['projet', 'project'], ['produit', 'product'], ['fonctionnalité', 'feature'],
  ['interface', 'interface'], ['flux', 'flow'], ['architecture', 'architecture'], ['composant', 'component'], ['dépendance', 'dependency'],
  ['performance', 'performance'], ['lenteur', 'slowness'], ['sécurité', 'security'], ['chiffrement', 'encryption'], ['réunion', 'meeting'],
  ['formation', 'training'], ['présentation', 'presentation'], ['décision', 'decision'], ['méthode', 'method'], ['procédure', 'procedure'],
];

const MAP = new Map<string, string[]>();
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
for (const [fr, en] of PAIRS) {
  for (const [a, b] of [[fr, en], [en, fr]] as const) {
    const k = norm(a);
    MAP.set(k, [...new Set([...(MAP.get(k) ?? []), norm(b)])]);
  }
}

/** The other language's words for a normalised term (empty when unknown). */
export function translations(term: string): string[] {
  return MAP.get(norm(term)) ?? [];
}

/** A query with its translations added: « facture client » → « facture client invoice customer ». */
export function bilingual(query: string): string {
  const words = norm(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const extra = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const w of [words[i]!, words.slice(i, i + 2).join(' '), words.slice(i, i + 3).join(' ')]) for (const t of translations(w)) extra.add(t);
  }
  for (const w of words) extra.delete(w);
  return extra.size ? `${query} ${[...extra].join(' ')}` : query;
}
