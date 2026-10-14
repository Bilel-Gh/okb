# Acceptation des correctifs d’usage — 13 octobre 2026

Le checkout `okb/`, propre au départ, a été choisi après comparaison avec les
copies anciennes. Les changements restent locaux, sans commit, publication ou
installation personnelle. Atelier, cinq destinations, TypeScript/Node/React,
Markdown et SQLite sont conservés. Progresser n’a pas été refondu.

## Retours, reproduction et corrections

| Retour | Cause reproduite ou indice confirmé | Correction | Preuve d’acceptation |
|---|---|---|---|
| Ticket déjà commencé | `startTicket` remplaçait le texte initial ; démarrage SQLite sans recherche de note | `tickets.resume` et le skill existant réconcilient suivi et notes autorisées, avec référence/repo et conflits | Régressions ticket, CLI et workspace : absent, note seule, suivi seul, informations humaines, multi-repos, ambiguïtés, données structurées et seconde invocation |
| Note mise à jour | Reprise de suivi et connaissance étaient deux parcours | Squelette ou complément en proposition, corps humain/unknown fields conservés, contrôle d’obsolescence | Matérialisation, garde et validation de fichiers sur fixtures ; refus et suggestion non acceptée conservés |
| Hooks silencieux | `resume` absent du matcher ; échec de lecture marqué « déjà envoyé » ; résolution divergente | Runtime commun et raisons bornées, retry après échec, identité de repo/session | Fixtures checkout/cache, PATH réduit, chemins avec espaces, délai, erreur CLI, JSON invalide, diagnostics désactivés |
| Projets/Repos/Tickets mêlés | Repos dans la liste ordinaire, journal entier en aperçu, fiche générique concurrente | Aperçu commun court, repo séparé, lien vers détail spécialisé et ancienne adresse préservée | Composants et parcours Chromium Today/Projects/Repos/ticket, clavier, mobile clair/sombre |
| Assistant peu utile | Index coupé à 6 000 caractères, contexte aux 4 000 premiers ; contexte de travail perdu au suivi | Note entière indexée, fenêtres brutes pertinentes avec lignes, actions depuis le travail et contexte persistant | Longue note avec passage final, reformulation, travail modifié, citation traversant deux fenêtres rejetée ; préparation sans appel et recherche locale |
| Architecture dense | Relations de groupes perdues, noms raccourcis, graphe rétréci, voies sur labels | Exploration limitée développable, labels complets, centrage et voies séparées, liste de relations | Fixtures dense/cycles/bases partagées/noms longs/incertitude ; 3 parcours Chromium et inspection réelle à 1440/1280/390 px |
| Fiabilité du modèle de graphe | Méthode dynamique supposée GET, mélange probable/sûr, technologie de base interprétée comme instance | Méthode inconnue, confiance conservatrice, périmètre/preuves explicites | Régressions HTTP, intégrité du modèle et export regroupé ; scan présenté comme statique |
| Correction tardive VTT | Recherche de correction limitée aux 12 blocs précédents et à la page | Index du snapshot complet et rapprochement lexical distant ; déclaration explicite du remplacement | Test rouge puis vert avec correction finale ; citations des deux passages et ancien fait gardé |
| Compte rendu d’une réunion | Cursor de livraison assimilable à lecture ; fragments peu structurés | Fenêtres délivrées et résultats analysés séparés, couverture et plages restantes, fusion sourcée | 1 800 blocs synthétiques, fenêtres et résultats idempotents, citations inventées/hors fenêtre refusées, invalidation source/extracteur |

## Contrôles logiciels et navigateur

`npm run release:check` passe : TypeScript moteur/web, compilation, **1 104 tests
dans 142 fichiers**, validation locale des **2 plugins / 55 composants**,
installation du paquet dans /tmp et parcours extraction → proposition → revue
→ application/rollback sur corpus fictif.

La revue indépendante a ajouté trois régressions concrètes : les réutilisations
secrètes restent masquées lors d’une reprise par un agent ; une note enrichie
redevient brouillon avec sa vérification antérieure gardée en historique ; un
changement du budget de découpage invalide index et ledger. Un budget de rapport
qui ne permet aucun intervalle restant renvoie une erreur explicite, plutôt
qu’une page vide au curseur inchangé.

La première tentative sandboxée a été arrêtée : les serveurs de fixtures
échouaient avec `listen EPERM`. Le contrôle a été relancé avec les ports locaux
temporaires autorisés. Deux échecs de budget de contexte ont ensuite été corrigés
en raccourcissant les descriptions et en déplaçant les procédures dans des
références à la demande ; les seuils n’ont pas été augmentés.

Les nouvelles captures ont été inspectées, pas seulement produites : navigation
dans Aujourd’hui, Projets, Repos, fiche ticket et Assistant ; graphes petits,
denses et cycliques, clair/sombre et écran étroit. Les vérifications mesurées du
graphe trouvent zéro chevauchement de noms, zéro traversée de label sur les
segments échantillonnés et zéro débordement de page dans ces fixtures. Cela ne
constitue ni inspection du graphe personnel ni certification d’accessibilité.

`npm run test:journeys` passe sur la compilation finale : **13 parcours Chromium
dans 3 fichiers**, dont la question Assistant visible/focalisée sans lancement,
la navigation du travail et les graphes denses/cycliques. Les contrôles de
console, overflow, focus et clavier sont ceux de ces fixtures.

Les anciennes adresses et le contenu humain restent disponibles. Aucune
migration de données n’est ajoutée pour nettoyer les listes. Le filtre change
la présentation, sans supprimer de projet.

## Claude réel, modèle et protections

Claude Code **2.1.289** valide nativement les deux plugins avec `--strict`,
`CLAUDE_CONFIG_DIR` et `OKB_HOME` temporaires. Les matchers et formats sont
confrontés à la [documentation officielle des hooks](https://code.claude.com/docs/en/hooks).
Les scripts sont exécutés contre des fixtures de processus ; ce n’est pas une
preuve de leur livraison au modèle dans une conversation réelle.

Une trace `started` prouve le début du script ; `context-sent` signifie JSON
émis. L’absence de trace ne permet pas de distinguer seule un plugin non chargé
d’un Node absent avant le démarrage. `/hooks`, la version et le debug de Claude
permettent ce diagnostic complémentaire. Un contexte envoyé ne prouve pas que
le modèle le suit. La portée annoncée est Claude Code, pas tous les agents.

Les garde-fous d’approbation et de lecture secrète ne sont pas rendus permissifs.
Consentement de suggestion, contrôle déterministe, revue éditoriale, proposition,
approbation et application restent distincts. Les relectures IA sont justifiées
pour les ambiguïtés/synthèses plutôt que systématiques. Rien n’est approuvé pour
la personne. Les tests d’approbation du dépôt utilisent uniquement les acteurs
et données fictifs ; aucune clé personnelle n’est lue ou changée.

## Mesures de transcript et runtimes

Le [banc synthétique](TRANSCRIPT-BENCHMARK-2026-10-13.json) et
`node scripts/bench-transcript.mjs <sortie.json>` décrivent 1 800 blocs, 42
sous-titres répétés, 5 repères connus et une correction finale. Le contrat
précédent est simulé, page par page, à budget estimé identique. Il ne relie pas
la correction finale ; la nouvelle recherche sélectionne les deux passages.
Le ledger garde les cinq repères et la chaîne de remplacement, avec zéro
omission des repères du banc. Les faits des fenêtres sont fournis par l’oracle
de la fixture, sans modèle : ce n’est pas un score de synthèse automatique.

| Mesure locale du banc | Résultat |
|---|---:|
| Extraction | 1 800 blocs, 11,3 ms |
| Recherche ciblée retention | 4 blocs de preuve, 568 tokens estimés dans l’objet mesuré |
| Index/recherche à froid, puis en cache mémoire | 30,5 / 0,1 ms |
| Ledger complet alimenté par l’oracle | 45 fenêtres, 757,5 ms, 5 repères gardés / 5 |
| Contrat précédent simulé | 42 pages ; lien de correction finale absent |

La machine compilait aussi l’application pendant cette mesure. Les enveloppes
du banc et les tokens des fenêtres ne représentent pas le coût cumulé réel d’un
parcours agent/CLI complet ; les octets mesurés et les limites sont conservés
dans le JSON reproductible. Le cache de recherche est en mémoire du processus,
le snapshot et le ledger sur disque.

La latence est celle de l’extraction/index/ledger local, hors processus CLI,
modèle et revue humaine. Les tokens utilisent l’estimation octets UTF-8 / 3,8,
sans tokenizer ni facture. Recherche ciblée et couverture complète ne sont pas
interchangeables ; un plus petit payload ne prouve pas une économie à qualité
égale. Aucun appel IA facturé ni comparaison à un assistant seul n’a été lancé.

Le minimum Node reste **22.13.0**, vérifié par API documentée et déclarations des
dépendances verrouillées. Tests sous Node **24.19.0** ; SQLite embarqué vérifié
avec **Electron 44.7.0 / Node 24.21.0** extrait temporairement du cache.
Voir [l’analyse des runtimes](NODE-RUNTIME.md). Le desktop ne demande pas une
installation Node à son utilisateur. Le binaire exact 22.13.0 et Windows ne
sont pas qualifiés par ces essais.

## Limites et validation d’usage restante

- Conversations/hooks avec un modèle réel, quota/session réellement épuisés et
  qualité d’une réponse à un vrai ticket : contrats et erreurs testés, mais
  aucun appel réel ni donnée professionnelle utilisés.
- Graphe complexe et VTT personnels : non consultés ; scanner statique et
  rapprochement lexical ne prouvent pas le comportement ou la vérité.
- Temps de reprise économisé, temps de revue/entretien, coût total et qualité :
  pilote humain à mesurer ensemble, sans conclure sur le marché.
- Windows, signature/notarisation, mise à jour et fenêtre desktop packagée :
  hors de cette validation locale. Aucune publication ou installation réelle.
- Le journal destiné au cerveau est préparé séparément dans une proposition
  isolée à relire ; aucune KB personnelle n’est mise à jour par ces contrôles.

La publication des notes et décisions dans un espace réel reste le geste humain
habituel. Le code corrige les défauts reproduits ; la reprise réelle avec moins
d’effort reste un critère d’usage à confirmer, pas un résultat inventé.
