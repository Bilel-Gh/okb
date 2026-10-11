# OKB 2.4.0 — Le quotidien du dev

Préparation locale non publiée ; porte d'usage en attente.

Livraison technique préparée le 11 octobre 2026. Un ticket se reprend avec son objectif, la dernière action, les essais échoués et leurs conditions, puis la prochaine étape. Le suivi reste local et sans IA.

- F2.4-01/02 : brief corrigible et états distincts pour travail, PR/revue, vérifications, attente et livraison par environnement. Une information inconnue reste inconnue ; finir ou fusionner ne signifie pas livrer.
- F2.4-03/04 : critères de fin visibles, clôture bloquée par les critères rendus obligatoires ; mémoire des essais avec conditions et résultat.
- F2.4-05/06 : notes citant du code modifié à revérifier dans Aujourd’hui, journal des essais et réutilisations avec la révision exacte de la note.
- F2.4-07 : lecture explicite de PR/CI GitHub par la session `gh` déjà configurée, sur dépôts autorisés ; instantané Jira fourni par la personne et marqué déclaré. Le lecteur Jira externe reste à valider.

Les tickets 1.5 sont importés une fois dans SQLite par la migration 7, sans suppression ni réécriture de leurs JSON ou textes d’origine. Les commandes et le suivi Git existants restent disponibles. Les anciens JSON deviennent des archives : ils ne suivent plus les nouvelles modifications. Les nouvelles opérations du module vivent sous `src/work/` ; le cœur reçoit ses contributions par un contrat de module.

Les tests automatisés utilisent uniquement des profils, dépôts et lecteurs externes fictifs. Ils couvrent les contrats, la migration, les gardes de clôture, la concurrence, le CLI compilé et la fraîcheur après commit. Ils ne valident pas une connexion GitHub réelle, un lecteur Jira externe, une reprise en moins d’une minute ni un mois sans oubli de livraison.

[Guide du ticket](../guide/reprendre-un-ticket.md) · [Contrat et limites](../dev/specs/2026-10-11-2.4-quotidien-dev.md)
