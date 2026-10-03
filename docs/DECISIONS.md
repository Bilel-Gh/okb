# Décisions et travail restant

Trace courte pour reprendre le projet sans l’historique de conversation.
Format : problème → décision → conséquence → condition de réexamen.

## État au 3 octobre 2026 (version locale 0.3.0, non publiée)

| Contrôle | Résultat |
|---|---|
| `npm run release:check` (Node 24.4) | 263 tests, plugin 23 composants, paquet installé proprement, lecteur local inclus |
| `claude plugin validate ./plugin` (Claude Code 2.1.27 du poste) | Validation passée ; `--strict` absent de cette version |
| Évaluations natives `claude plugin eval` | Non exécutées (11 cas prêts dont `revise-fr`) |

## D1 — Le style de rédaction devient un paramètre du produit

- **Problème.** Seuls `answer.language` et `answer.style` existaient ; aucun n’était
  lu par le code. Le rendu d’article codait des libellés français et ne permettait
  ni explication, ni analogie, ni schéma.
- **Décision.** Clés `writing` (preset + 8 réglages + consignes libres) et `reader`
  (niveau global et par domaine), résolues par `src/style/resolve.ts` ; brief
  généré par `okb style`. Trois presets seulement. Règles communes figées dans le code.
- **Conséquence.** Le style est versionné dans le dossier et la proposition ; un
  changement de style ne réécrit rien (`STYLE_DIFFERS` dans `okb maintain`).
- **Réexamen.** Si un lecteur réel ne peut être servi par trois presets + surcharges.

## D2 — Dossier v2 : aides pédagogiques rattachées aux affirmations

- **Problème.** Expliquer simplement exige de la prose non sourcée ; la publier
  sans contrôle casserait la traçabilité.
- **Décision.** Les faits restent des `claims` avec extraits verbatim. Les aides
  (`explanation`, `analogy` avec `limits`, `diagram` Mermaid, `example`) déclarent
  `basedOn`. Le noyau vérifie le câblage et la cohérence avec le style ; le
  réviseur vérifie qu’aucun fait n’est ajouté.
- **Réexamen.** Si les revues montrent des faits glissés dans les aides malgré le
  réviseur : rendre les aides optionnelles à la sélection (changements séparés).

## D3 — Plusieurs sources par article et adaptateur de code

- **Problème.** « Montre où regarder dans le code » exige de citer une doc et les
  fichiers qui l’implémentent ; une source par proposition fragmentait les articles.
- **Décision.** `--with` + `sources[]` dans le dossier v2 ; adaptateur `code`
  (lignes, symbole de premier niveau, titre relatif au projet, rien d’exécuté).
- **Réexamen.** Si des fichiers de code longs rendent la couverture totale trop
  coûteuse : ajouter une extraction par plage de lignes déclarée partielle.

## D4 — Révision de style par proposition, éléments protégés

- **Décision.** `okb revise` remplace une seule note ; citations, code, définitions
  et références de notes de bas de page doivent rester identiques à l’octet ; seul
  `title`/`description`/`tags` change dans le frontmatter ; la note repasse `draft`.
- **Réexamen.** Si l’on veut réviser une section seulement (diff plus petit).

## D5 — `plugin/bin/okb`

- **Problème.** Le plugin supposait un `okb` global de la bonne version.
- **Décision.** Wrapper dans `bin/`, mis sur le PATH de l’outil Bash par Claude
  Code ; repli sur un autre `okb` du PATH.
- **Réexamen.** À vérifier sur la version de Claude Code et le mode de distribution
  réels (la doc indique que claude.ai/Cowork refusent les plugins avec `bin/`).

## D6 — Propositions liées et combinaison

- **Problème.** Une note n’existe qu’après approbation : un parcours de lecture
  préparé en une session ne pouvait pas se relier, et chaque note exigeait sa
  propre approbation.
- **Décision.** `--after` superpose en mémoire les créations des propositions en
  attente ; `okb combine` fusionne des propositions sans fichier commun en une
  seule (ids préfixés, contenu inchangé, parties marquées `superseded`).
- **Conséquence.** Une approbation signée couvre exactement l’ensemble ; le
  contrôle des liens au moment d’appliquer reste la garantie.
- **Réexamen.** Si deux propositions doivent modifier le même fichier : il faudra
  un vrai rebasage plutôt qu’un refus.

## Gardé tel quel, avec avis

- **Commandes + skills.** Les commandes ont fusionné avec les skills dans Claude
  Code ; les huit fichiers `commands/` ne servent qu’à des noms courts
  (`/okb:ingest`). Coût de contexte nul (`disable-model-invocation`). À fusionner
  si l’on renomme les skills (`name: ingest`) — impact sur les évaluations.
- **`okb route`.** Sélecteur à expressions régulières qui documente le contrat de
  routage mais ne mesure pas Claude. À retirer dès que les évaluations natives
  tournent régulièrement.
- **Recherche lexicale.** Suffisante tant que les échecs mesurés ne montrent pas
  de besoin sémantique (reformulations FR/EN notamment).

## Travail restant (par priorité)

1. Exécuter les évaluations natives sur le poste cible ; ajouter un cas
   « personnalisation » (mêmes faits, deux styles).
2. Valider le chargement du plugin, `bin/okb` et le hook sur la version de Claude
   Code et les réglages administrés du poste professionnel.
3. Traduction complète via revise : les titres H2 restent protégés.
4. Fraîcheur des sources distantes : prévue, non implémentée ; la comparaison des
   fichiers locaux est disponible explicitement avec `maintain --check-sources`.
5. Liens « pour aller plus loin » vers une note créée plus tard : aujourd’hui
   omis avec une note dans la proposition ; il faut une révision ultérieure.

## D7 — Ajustements révélés par la construction de la KB pédagogique

Utiliser le produit sur un vrai cas a montré des défauts que les tests ne voyaient pas :

- Les définitions sourcées du dossier passent avant les candidats heuristiques
  dans la limite de suggestions.
- Liens vers les fiches : chaque terme est relié une fois avant toute répétition ;
  `maxLinksPerTermPerDocument` plafonne les répétitions ; les sections
  « Pour aller plus loin » ne reçoivent pas de liens.
- Notes de bas de page v2 : section et numéro de ligne, sans répéter le titre.
- Titre d’un fichier Markdown sans `title` : champ `name` du frontmatter avant le
  premier H1 (cas des skills et agents).
- Index généré trié par chemin : un préfixe numérique fixe l’ordre de lecture.
- Description d’une fiche concept = sa définition sourcée.
- `okb review <id> --discard` écarte une proposition préparée devenue inutile.
- Une fiche concept cite et affiche les extraits de chacune de ses sources.
- Les cellules d’un tableau Markdown restent séparées (« a | b ») dans les blocs.
- Une revue indépendante des 9 articles par un sous-agent a corrigé des aides qui
  ajoutaient des faits et deux surinterprétations, avant toute approbation.

## D8 — Modèles de notes et fiches concepts pédagogiques

- **Problème.** Le style réglait la manière d’écrire, pas la structure : deux notes
  du même type pouvaient avoir des sections différentes, et les fiches concepts
  se limitaient à une définition et une citation.
- **Décision.** Six modèles (guide, concept, procédure, retour d’expérience,
  décision, réunion) dont le CLI impose rôles, ordre et titres ; surcharge par KB
  dans `.okb/templates/` ; fiches concepts complètes (définition, analogie et sa
  limite, fonctionnement, exemple, schéma, confusions) avec alias ; liens posés à
  partir du texte rédigé, pluriels compris, et entre fiches.
- **Réexamen.** Si un type de note revient souvent sans modèle adapté.

## D9 — Fin de reprise : modèles, preuves et concurrence

- Modèles personnalisés : ordre respecté, rôles et identifiants validés, erreurs
  YAML lisibles. Les fiches riches rattachent toutes leurs preuves au changement,
  y compris les sources secondaires ; leurs libellés suivent le style fr/en.
- Une édition pendant la préparation des écritures reste une divergence, jamais
  une nouvelle référence silencieuse. La reprise revalide liens et structure.
- Une proposition écartée reste consultable mais ne peut plus être approuvée ou
  appliquée ; discard retire sa signature éventuelle.
- Les alias identiques au titre ne créent pas de fausse ambiguïté. L’audit des
  orphelins utilise le parseur Markdown partagé plutôt qu’une regex de liens.

## D10 — Fraîcheur locale explicite

- **Problème.** Une note peut citer un fichier local qui a changé depuis l’import.
- **Décision.** `maintain --check-sources` utilise les empreintes et métadonnées
  privées déjà conservées, sans réseau ni archivage supplémentaire. Absence,
  changement ou comparaison impossible sont distingués.
- **Conséquence.** Aucune vérité métier n’est déduite du hash ; aucun ancien profil
  ne commence à relire des chemins sources sans cette option explicite.
- **Réexamen.** Pour sources distantes ou contrôle automatique après accord utilisateur.

## D11 — Lecteur local avec le même moteur de proposition

- **Problème.** Lire beaucoup d’articles et leurs diffs dans un terminal est coûteux.
- **Décision.** `okb serve`, Node HTTP natif, assets embarqués, 127.0.0.1 uniquement,
  API en lecture seule, rendu DOM texte et aucune dépendance distante.
- **Conséquence.** Aperçus et diffs utilisent `materializeFile` ; source et résultat
  restent consultables. L’utilisateur signe dans le terminal. Le rendu Mermaid
  complet reste celui d’Obsidian. Aucun second système d’approbation.
- **Réexamen.** Après retour d’usage sur la lecture et le temps de revue, avant
  d’ajouter édition navigateur ou service multiutilisateur.

Le diagnostic et les contrats Claude consultés sont dans
[DIAGNOSTIC-2026-10.md](DIAGNOSTIC-2026-10.md) et
[CLAUDE-COMPATIBILITY.md](CLAUDE-COMPATIBILITY.md).

## D12 — Symbole des blocs de code

- **Problème.** Une longue fonction découpée en plusieurs blocs donnait aux blocs
  suivants le nom d’une variable locale (`before`), ce qui rendait la note de bas
  de page trompeuse.
- **Décision.** Seule une déclaration de premier niveau nomme un bloc ; les blocs
  suivants gardent le nom de la déclaration qu’ils prolongent.


## D13 — Aucun secret dans une proposition

- **Problème.** Une citation est recopiée telle quelle : une clé API présente dans
  un transcript, un README ou un support de cours finirait dans une note, parfois
  synchronisée ou partagée. Seule la configuration affichée était masquée.
- **Décision.** `src/security/secrets.ts` reconnaît les formats de jetons connus
  et les affectations explicites (`api_key = …`, identifiants dans une URL) dont
  la valeur est réaliste ; les gabarits (`<API_KEY>`, `sk-xxxx…`, `process.env…`)
  passent. L'enregistrement d'une proposition ou d'une capture est refusé
  (`E_SECRET`, extrait masqué) ; l'application recontrôle les fichiers produits ;
  `okb maintain` signale `SECRET_IN_NOTE` dans les notes écrites à la main.
- **Limites.** Détection par motifs, pensée pour la précision : un mot de passe
  court sans contexte ou un format inconnu passe. Ce n'est pas un scanner de
  sécurité ; une clé exposée doit être révoquée.

## D14 — Capture, revue hebdomadaire et révision active

- **Problème.** OKB savait transformer une source en notes vérifiées, mais rien
  n'accueillait une idée au vol, rien ne rappelait ce qui attend, et rien n'aidait
  à retenir ce qui a été appris. Un développeur junior qui reçoit beaucoup
  d'informations chaque jour perd la plupart de ce qu'il ne capture pas, et
  oublie vite ce qu'il ne relit pas.
- **Décision.** `okb capture` et `okb inbox` : une inbox **privée** dans l'état du
  profil, jamais dans la KB, triée élément par élément vers des propositions ;
  les éléments traités sont déplacés, jamais supprimés. `okb weekly` : un rapport
  en lecture seule (inbox, propositions en attente, notes appliquées, notes à
  relire à J+1, 7, 30, 90, maintenance). Trois skills (`okb-inbox`,
  `okb-weekly`, `okb-learn`) et quatre commandes. L'approbation humaine reste le
  seul chemin vers la KB.
- **Inspirations.** Pratiques courantes de gestion des connaissances (boîte de
  réception, revue hebdomadaire, répétition espacée, rappel actif), réécrites pour
  le modèle de proposition d'OKB.
- **Limites.** Pas de planification automatique (une tâche planifiée qui lancerait
  Claude sans surveillance n'est pas fournie) ; les jalons de relecture sont fixes ;
  `okb-learn` dépend du modèle pour la qualité des questions.

## D15 — Ce que la construction des KB du 3 octobre a révélé

- **Chemin local dans les notes.** Une source sans titre était nommée par son URI
  `file:///…` complète dans les notes de bas de page et les fiches : le chemin du
  dossier privé de l'auteur entrait dans la KB. `sourceLabel` nomme désormais la
  source par son titre, sinon par son nom de fichier ; la ressource reste
  `urn:sha256:…`.
- **Fiches devinées.** Avec un dossier v2, l'auteur choisit les fiches concepts ;
  un sigle repéré par heuristique (« RAM », « Q4 ») créait pourtant une fiche
  mince, hors modèle. Il devient une suggestion dans les notes de la proposition.
- **« Voir aussi » entre fiches nouvelles.** Une fiche pouvait citer une fiche
  existante, pas une fiche créée par la même proposition ; leurs chemins sont
  maintenant réservés avant la rédaction, et le lien est contrôlé avec le reste.
- **Plafond d'application.** `policy.maxApplyFiles` (50) reste un plafond qu'aucun
  profil ne relève ; une KB plus grosse s'applique en deux propositions : le
  contenu, puis les index de navigation qui ne pointent que vers lui.
- **Proposition déjà appliquée.** La réappliquer ou la réapprouver répond « already
  applied » avec la commande d'annulation (avant : « apply already started » ou une
  fausse alerte E_STALE suggérant de réingérer) ; `okb review` l'affiche sans diff
  trompeur. `--resume` reste réservé aux applications interrompues.
- **Schémas comme code.** `.prisma`, `.graphql`/`.gql` et `.proto` sont lus par
  l'adaptateur de code (version 3) ; `model`, `message` et `service` nomment les blocs.
