import type { EN_LANDSCAPE } from './landscape.en.js';
export const FR_LANDSCAPE: Record<keyof typeof EN_LANDSCAPE, string> = {
  'arch.cert.proved': 'prouvée', 'arch.cert.declared': 'déclarée', 'arch.cert.supposed': 'supposée', 'arch.cert.confirmed': 'confirmée',
  'arch.role.call': 'ressource externe (appelée)', 'arch.role.endpoint': 'ressource externe (adresse en configuration)', 'arch.role.registry': 'registre de paquets', 'arch.role.source-host': 'hébergement du code', 'arch.role.doc': 'lien de documentation', 'arch.role.asset': 'ressource de page', 'arch.role.platform': 'plateforme', 'arch.role.unknown': 'à classer',
  'arch.offMap': 'Pas sur la carte : {list}', 'arch.excludedCount': 'Exclues par toi : {n} — okb arch link list', 'arch.staleCount': 'Corrections sans effet depuis les derniers scans : {n}', 'arch.conflictCount': 'L’agent a dit autre chose sur {n} relation(s) : okb arch conflict <clé> mine|agent',
  'arch.link.kept': 'Correction gardée ; les prochains scans la respectent.', 'arch.link.conflict': 'Tu as déjà tranché cette relation : la réponse de l’agent est gardée comme écart, à toi de choisir.', 'arch.link.same': 'C’est déjà le cas : rien n’a changé.', 'arch.link.reset': 'Correction retirée : la relation redevient ce que disent les scans.',
  'arch.url.kept': '{host} est désormais « {role} » pour tous les repos.', 'arch.url.forgot': 'Règle retirée pour {host}.', 'arch.conflict.settled': 'Écart tranché.',
  'arch.links.title': 'Relations de {name}, avec leurs clés', 'arch.links.excluded': 'Exclues', 'arch.links.stale': 'Ne correspondent plus à rien',
  'err.archTargetUnknown.title': 'Cette cible n’est pas sur la carte', 'err.archTargetUnknown.why': 'Une relation va vers un repo cartographié de ce KB (repo:<nom>) ou vers une ressource externe (ext:<hôte>).', 'err.archTargetUnknown.fix': 'Liste les relations et leurs extrémités avec okb arch link list, puis réessaie.',
  'err.archConflictUnknown.title': 'Aucun écart sur cette relation', 'err.archConflictUnknown.why': 'L’agent n’a rien dit de différent, ou l’écart a déjà été tranché.', 'err.archConflictUnknown.fix': 'Liste les relations avec okb arch link list.',
};
