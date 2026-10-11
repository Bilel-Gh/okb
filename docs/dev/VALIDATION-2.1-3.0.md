# Validation technique 2.1–3.0 — 11 octobre 2026

Le travail de développement suit D64 à D68 : partage à deux, compréhension,
assistant local, suivi des tickets et emballage desktop. Atelier et les cinq
destinations sont conservés. Ce bilan décrit un checkout local non publié ;
le numéro du paquet reste `2.0.0`, base de développement, et ne déclare pas une
3.0 stable.

## Contrôles réussis

| Contrôle | Résultat et portée |
|---|---|
| `npm run release:check` | TypeScript moteur/web, compilation, **1 048 tests dans 131 fichiers**, validation statique des deux plugins et installation propre du paquet : succès. |
| `claude plugin validate ./plugin --strict` et `./plugins/okb-dev --strict` | Les deux validations natives Claude passent. Elles ne testent pas une réponse du modèle. |
| Installation du paquet | Installation isolée, accueil CLI, extraction paginée, analyse, aperçu, lecteur HTTP local, approbation/application sur données fictives, liens et retour arrière : succès. |
| Prototype Mac ARM64 | `node scripts/desktop-build.mjs --dir` produit `desktop-build/mac-arm64/OKB.app`, environ 397 Mio sur disque, Electron 44.7.0. Build **non signé** ; politique source restaurée à `{}` après construction. |
| Runtime embarqué du paquet | Exécution de la CLI avec le Node embarqué, état SQLite, initialisation MCP, `notes_find` et `notes_read` sur un espace fictif : succès. Ce contrôle ne lance pas la fenêtre ni un modèle. |
| Second agent réel | Codex `0.159.0-alpha.12.1`, explicitement expérimental : recherche et lecture MCP d'une note fictive, réponse avec citation exacte reçue. Cela ne qualifie pas toutes les versions ni tous les environnements d'entreprise. |

Les tests couvrent notamment refus de partage privé, fichiers Git étrangers
préservés, citations et confidentialité MCP, annulation des agents, migration et
fusion des tickets, erreurs I/O de sauvegarde, récupération après interruption,
export complet et arrêt du serveur avant fermeture de SQLite. Les tests UI sont
des tests de composants ; ils ne remplacent pas une inspection de l'application.

## Recherche sur un corpus synthétique

Mesure locale sous Node 24.19.0, macOS ARM64, **5 215 notes fictives**, sans IA.
Le benchmark a tourné pendant la fin de la construction desktop ; la machine et
son activité influencent les chiffres.

| Mesure | Résultat |
|---|---:|
| Chargement, trois passages | 2 127 / 309 / 59 ms |
| Première recherche à froid | 1 605 ms |
| Recherche en cache, médiane | 72 ms |
| Recherche en cache, 95e percentile | **90 ms** |
| Six requêtes d'accueil | 576 ms |
| Recherche après modification d'une note | 318 ms |

L'objectif de recherche en cache sous 200 ms est atteint dans ces conditions.
Le démarrage et l'invalidation du cache restent plus coûteux ; ce résultat
n'est pas une garantie sur toute machine ou tout corpus. Reproduction :
`node scripts/perf.mjs --sizes 5000 --out <fichier-resultat.json>` après compilation.

## Validations encore ouvertes

- **Claude Code réel** : l'installation 2.1.289 est détectée et les contrats
  sont testés. L'essai de génération renvoyait `E_IO` ; la cause est établie :
  sur la machine d'essai, la session du `claude` en ligne de commande avait
  expiré (tout appel `claude -p` échouait de la même façon, sans consommer de
  tokens). OKB le dit désormais (`agentNotSignedIn` : ouvrir un terminal, lancer
  `claude`, se connecter). Une réponse réelle reste à obtenir une fois connecté.
- **Interface et accessibilité** : les neuf parcours navigateur
  (`npm run test:journeys`) passent, et les écrans Assistant, Partager, Tickets
  et Comprendre ont été ouverts en largeur étroite sans erreur de console.
  Contrôle clair/sombre complet, lancement de la fenêtre packagée, lecteur d'écran et
  contraste réel non vérifiés dans cette reprise. Les noms, titres, focus et
  clavier testés ne constituent pas une certification WCAG.
- **Distribution** : signature, notarisation, installation Windows, mises à
  jour signées sur les deux OS et choix des identités/feeds sont en attente.
  Le prototype désactive les mises à jour ; aucun artefact n'est publié.
- **Intégrations et usage** : autorisation du dépôt partagé au travail,
  lecture GitHub réelle et conditions contractuelles des agents restent à
  confirmer dans le contexte cible. Jira accepte un état déclaré ; le lecteur
  distant Jira n'est pas implémenté. Les pilotes et durées d'usage de la feuille
  de route ne sont pas remplacés par les fixtures.
- **Dépendances** : l'audit des dépendances de production relève cinq entrées
  (deux faibles, trois modérées), aucune haute ou critique. Les dépendances
  concernées, les avis et les limites sont dans [SECURITY](SECURITY.md).
- **Dette existante** : douze dépendances cœur/dev demeurent ; pas de
  réécriture de ce socle. La compilation signale aussi que `Day.tsx`, importé
  statiquement par la palette, ne peut pas être isolé par son import dynamique.

## Documents et suite

Specs : [2.1](specs/2026-10-11-2.1-partage.md),
[2.2](specs/2026-10-11-2.2-comprendre.md),
[2.3](specs/2026-10-11-2.3-assistant.md),
[2.4](specs/2026-10-11-2.4-quotidien-dev.md),
[3.0](specs/2026-10-11-3.0-desktop.md).
Les [décisions D64–D68](DECISIONS.md), guides et notes de version distinguent
code disponible et validations d'usage.

La publication dans la KB passe par des propositions de journal, décision et
avancement de Todo. Une proposition préparée n'est pas une note publiée : la
personne conserve l'approbation et l'application. Les espaces réels ne sont
pas migrés par ces contrôles techniques.
