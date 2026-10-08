/**
 * Finding a note by what it means, offline and without a model: words are cut
 * to their root (« remboursements » and « rembourser » meet at « rembours »),
 * and families of everyday work words are searched together (« renvoyer »,
 * « retour », « retourner »). It sits beside the word search and the two lists
 * are merged (src/find/find.ts). A local embedding model can be plugged in
 * later behind the same place (roadmap §8.1); this layer needs nothing.
 */

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Words that carry no meaning in a question. */
const STOP = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'l', 'au', 'aux', 'et', 'ou', 'en', 'a', 'à', 'dans', 'par', 'pour', 'sur', 'avec', 'sans', 'est', 'sont',
  'que', 'qui', 'quoi', 'quel', 'quelle', 'quand', 'comment', 'pourquoi', 'ou', 'on', 'il', 'elle', 'ils', 'je', 'j', 'tu', 'nous', 'vous', 'se', 's', 'si', 'ne', 'pas',
  'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'leur', 'faire', 'fait', 'deja', 'plus', 'tout', 'tous', 'une', 'fois', 'selon', 'savoir', 'en',
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'how', 'what', 'when', 'who', 'why', 'do', 'does', 'i', 'my', 'we', 'it', 'and', 'or',
]);

const SUFFIXES = [
  'issements', 'issement', 'ements', 'ement', 'ations', 'ation', 'itions', 'ition', 'euses', 'euse', 'eurs', 'eur', 'ables', 'able', 'ibles', 'ible',
  'ites', 'ite', 'iques', 'ique', 'istes', 'iste', 'ances', 'ance', 'ences', 'ence', 'ments', 'ment', 'ees', 'ee', 'es', 'er', 'ez', 'ir', 'ais', 'ait', 'aient',
  'ant', 'ants', 'antes', 'ante', 'ions', 'ons', 'ent', 'e', 's', 'x', 'ings', 'ing', 'ed', 'ies', 'y',
];

/** A light root of a word, French and English: accents gone, the usual endings cut, at least three letters left. */
export function stem(word: string): string {
  let w = fold(word).replace(/[^a-z0-9]/g, '');
  if (w.length <= 3) return w;
  for (let pass = 0; pass < 2; pass++) {
    const s = SUFFIXES.find((x) => w.endsWith(x) && w.length - x.length >= 3);
    if (!s) break;
    w = w.slice(0, -s.length);
  }
  return w;
}

/**
 * Families of everyday work words that mean the same thing in a question. Kept
 * general on purpose (commerce, IT, support): a brain's own words come from its
 * notes' aliases and its glossary.
 */
const FAMILIES: readonly (readonly string[])[] = [
  ['payer', 'paie', 'paiement', 'payé', 'impayé', 'régler', 'règlement', 'réglée', 'pay', 'payment', 'unpaid'],
  ['facture', 'facturer', 'facturation', 'invoice', 'billing'],
  ['impayé', 'impayés', 'ne paie pas', 'pas payé', 'retard de paiement', 'relance', 'relancer', 'échéance', 'unpaid', 'overdue', 'dunning', 'reminder'],
  ['rembourser', 'remboursement', 'avoir', 'refund', 'credit'],
  ['renvoyer', 'renvoie', 'retour', 'retourner', 'retourne', 'return'],
  ['annuler', 'annulation', 'supprimer', 'cancel', 'delete'],
  ['commande', 'commander', 'panier', 'order'],
  ['livraison', 'livrer', 'livré', 'expédition', 'expédier', 'colis', 'transporteur', 'delivery', 'shipping', 'parcel'],
  ['suivi', 'suivre', 'statut', 'où en est', 'tracking', 'status'],
  ['client', 'customer'],
  ['fournisseur', 'achat', 'acheter', 'supplier', 'purchase'],
  ['prix', 'tarif', 'tarifaire', 'coût', 'remise', 'price', 'pricing', 'discount'],
  ['taxe', 'tva', 'taux', 'tax', 'vat'],
  ['stock', 'inventaire', 'entrepôt', 'inventory', 'warehouse'],
  ['connexion', 'connecter', 'authentification', 'identité', 'login', 'sign in', 'sso'],
  ['mot de passe', 'réinitialiser', 'réinitialisation', 'oublié', 'password', 'reset'],
  ['droit', 'rôle', 'permission', 'habilitation', 'autorisation', 'valider', 'role', 'access'],
  ['déployer', 'déploiement', 'mise en production', 'prod', 'production', 'livrer une version', 'deploy', 'release'],
  ['revenir', 'retour arrière', 'version précédente', 'rollback', 'revert'],
  ['sauvegarde', 'sauvegarder', 'restaurer', 'restauration', 'backup', 'restore'],
  ['lent', 'lenteur', 'temps de réponse', 'performance', 'slow', 'latency'],
  ['alerte', 'prévenir', 'prévenu', 'notifier', 'supervision', 'surveillance', 'alert', 'monitoring'],
  ['erreur', 'panne', 'bug', 'anomalie', 'incident', 'error', 'outage'],
  ['carte', 'carte bancaire', 'cb', 'card'],
  ['emballer', 'emballage', 'préparer', 'préparation', 'prélever', 'pack', 'picking'],
  ['article', 'produit', 'marchandise', 'item', 'product'],
];

/** Each root → the roots of its family (itself included). */
const FAMILY_OF = new Map<string, Set<string>>();
for (const family of FAMILIES) {
  const roots = new Set(family.flatMap((w) => w.split(/\s+/).filter((x) => !STOP.has(fold(x))).map(stem)).filter((r) => r.length >= 2));
  for (const r of roots) FAMILY_OF.set(r, new Set([...(FAMILY_OF.get(r) ?? []), ...roots]));
}

/** The roots of a text, meaningless words left out: what the meaning index holds. */
export function roots(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem).filter((r) => r.length >= 2);
}

/** The roots of a question, with their families: what the meaning search looks for. */
export function meaningQuery(question: string): string[] {
  const out = new Set<string>();
  const folded = fold(question);
  // Whole expressions first (« mot de passe », « temps de réponse »).
  for (const family of FAMILIES) for (const w of family) if (w.includes(' ') && folded.includes(fold(w))) for (const r of FAMILY_OF.get(stem(w.split(' ')[0]!)) ?? []) out.add(r);
  for (const r of roots(question)) {
    out.add(r);
    for (const f of FAMILY_OF.get(r) ?? []) out.add(f);
  }
  return [...out];
}
