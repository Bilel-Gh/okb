# Décisions et travail restant

Trace courte pour reprendre le projet sans l’historique de conversation.
Format : problème → décision → conséquence → condition de réexamen.

## État au 7 octobre 2026 (version 1.0.0)

| Contrôle | Résultat |
|---|---|
| `npm run release:check` (Node 24.4) | voir [RELEASE-1.0.0.md](../releases/RELEASE-1.0.0.md) : tests, deux plugins, paquet installé proprement |
| `claude plugin validate ./plugin` et `./plugins/okb-dev` | Validation passée |
| Évaluations natives `claude plugin eval` | Non exécutées : la session de développement n'a pas d'accès à la connexion Claude ; cas prêts dans `plugin/evals/` (étiquettes `quality`, `consent`, `routing`) |
| Bêta de deux semaines | À faire par la personne, avec `okb metrics` chaque semaine |

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
  relire à J+1, 7, 30, 90, maintenance). Trois skills (`okb-capture`,
  `okb-today`, `okb-learn`) et quatre commandes. L'approbation humaine reste le
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

## D16 — Focus du moment et journal de session

- **Problème.** Chaque session Claude repartait de zéro : rien ne disait sur quoi
  l'utilisateur travaillait, ni où la session précédente s'était arrêtée. Les
  méthodes de second cerveau répondent par un fichier de contexte lu en premier
  et un rituel de fin de session.
- **Décision.** Deux fichiers privés hors de la KB : la **note de focus**, écrite
  par la personne (`okb focus init|set`, version précédente conservée dans
  l'état), et le **journal des sessions**, un fichier par mois écrit par `okb done`
  (résumé, fait, décidé, prochaine fois ; chaque `--keep` devient une capture de
  l'inbox). Un hook `SessionStart` du plugin donne à Claude la note de focus et la
  dernière « prochaine fois » (`okb focus --context`), en les marquant comme
  données de l'utilisateur. `okb weekly` signale un focus de plus de
  `focus.staleDays` jours et liste les sessions de la période. Skill `okb-today`,
  commandes `/okb:done` et `/okb:focus`.
- **Conséquence.** La mémoire entre sessions ne passe pas par la KB : une
  connaissance n'y entre toujours que par une proposition approuvée. Plusieurs
  profils peuvent partager une même note de focus (`focus.file`). Le hook n'écrit
  rien et se tait sans profil ni focus ; `focus.sessionStart: false` le coupe.
- **Réexamen.** Si le texte injecté au démarrage devient trop long ou si
  l'utilisateur veut un focus par projet.

## D17 — Des process aux skills : `okb skillify`

- **Problème.** Une procédure documentée dans la KB reste à recopier à la main pour
  devenir un skill Claude, et un skill rempli par l'IA sans relecture reste générique.
- **Décision.** `okb skillify <note>` produit un brouillon déterministe de
  `SKILL.md` à partir des sections de la note (quand l'utiliser, avant de
  commencer, étapes, vérifier, si ça ne marche pas), sans notes de bas de page ni
  blocs de code, et cite la note. Sans `--out`, rien n'est écrit ; `--out` refuse
  la KB elle-même et n'écrase rien sans `--force`. La skill `okb-skillify` affine
  le brouillon avec la personne, une question à la fois, conseille un skill de
  projet (`.claude/skills/`) plutôt qu'un skill global, puis le fait tester.
- **Réexamen.** Si les notes sources ont souvent des étapes imbriquées : conserver
  la hiérarchie au lieu d'une liste plate.

## D18 — Modèles `process`, `tool` et `automation`

- **Problème.** Les modèles couvraient l'explication et le dépannage, pas
  l'organisation : décrire une activité qui revient, un outil, un flux automatisé.
- **Décision.** `process` (livrable, fréquence et déclencheur, étapes, priorité
  temps / pénibilité / impact, ce que l'IA peut en faire), `tool` (usage, accès,
  coûts datés, données), `automation` (déclencheur, déroulé, surveillance, panne).
  Une procédure explique comment faire ; un process décrit ce qui revient, pour le
  prioriser et le déléguer.
- **Réexamen.** Si une équipe impose ses propres rubriques : `.okb/templates/`.

## D19 — Historique Git de la KB et dossiers cachés

- **Problème.** `git.autoCommit` existait dans le schéma mais levait une erreur.
  Une KB versionnée restait donc modifiée après chaque application, et un
  `.github/README.md` était lu comme une note.
- **Décision.** Avec `git.autoCommit: true`, chaque application et chaque
  annulation committe exactement les fichiers du reçu (`git add` puis
  `git commit --only`), avec l'identifiant de la proposition et du reçu dans le
  message ; les autres modifications restent intactes, les hooks Git de
  l'utilisateur s'exécutent, rien n'est jamais poussé. Un échec de commit ne
  défait pas l'application : il est signalé. Les dossiers cachés (`.git`,
  `.github`, `.obsidian`, `.okb`, `.trash`) ne contiennent jamais de notes.
- **Réexamen.** Si l'on veut pousser automatiquement : il faudra une liste de
  dépôts autorisés (`git.allowedRemotes`) et une confirmation explicite.

## D20 — Configuration guidée et convention de nommage

- **Problème.** La configuration posait toutes les questions d'un coup, et les noms
  des KB (dossier, profil, dépôt) divergeaient vite quand on en a plusieurs.
- **Décision.** La skill `okb-setup` pose une question à la fois, avec une
  réponse recommandée, puis récapitule avant d'écrire. Elle recommande un seul nom
  par KB : dossier `kb-<nom>`, profil `<nom>`, dépôt `kb-<nom>`, toutes les KB
  dans un même coffre Obsidian. `okb setup --from` accepte aussi `focus` et `git`.
- **Réexamen.** Si un utilisateur a besoin de plusieurs coffres séparés.

## D21 — Une interface pour des personnes, pas pour des développeurs

- **Problème.** `okb setup --profile notes --kb-root … --concept-assist …` exigeait
  de connaître le modèle interne ; les erreurs étaient des codes en anglais.
- **Décision.** `okb init` / `okb new` : un assistant d’une question à la fois
  (@clack/prompts), réponse recommandée marquée ★, récapitulatif avant d’écrire.
  `okb` seul ouvre un menu. Chaque erreur porte une clé (`err.<clé>.title|why|fix`)
  et un code expliqué par `okb explain`. Questions seulement sur un vrai terminal,
  jamais en `--json`, `--yes`, CI ou depuis le plugin (`OKB_NO_INTERACTIVE`).
- **Conséquence.** `okb setup` et les commandes historiques restent pour les scripts
  et la compatibilité, rangées dans « avancé ».
- **Réexamen.** Si un usage non interactif courant manque d’un drapeau.

## D22 — Deux langues indépendantes

- **Décision.** `ui.language` (auto/fr/en, toutes les KB) pour l’interface ;
  `writing.language` par KB pour la rédaction. Catalogues EN/FR typés : une clé
  absente en français casse la compilation. La sortie `--json` reste en anglais
  (contrat stable pour les outils).
- **Réexamen.** Si une troisième langue d’interface est demandée.

## D23 — Reconnaître une demande en langage naturel, proposer sans agir

- **Problème.** Personne ne connaît les commandes par cœur ; « ok fin de session »
  devait suffire.
- **Décision.** Un hook `UserPromptSubmit` appelle `okb route --suggest` ; si le
  message ressemble à une tâche OKB, Claude reçoit une *offre* et la présente avec
  un bouton. Règles volontairement prudentes : « undo that » ou « capture d’écran »
  ne déclenchent rien (contexte de code). `routing.suggest: false` coupe tout.
- **Réexamen.** Quand les évaluations natives mesurent la sélection des skills : les
  règles pourront être réduites.

## D24 — Cohabiter avec les autres outils de connaissance

- **Problème.** Un agent support peut avoir sa propre KB qu’il cherche et enrichit ;
  OKB ne doit jamais y écrire ni répondre à sa place.
- **Décision.** Marqueur `.okb/owner.yaml` : OKB n’écrit que dans ses KB (créées ou
  adoptées explicitement) ; un dossier contenant des notes d’un autre outil est
  refusé ; deux KB ne se chevauchent jamais. Les plugins et serveurs MCP installés
  (et `routing.otherKnowledgeTools`) sont détectés : « la KB support » ne déclenche
  pas OKB, « ma KB » ambiguë déclenche une question. L’assistant ne propose comme
  emplacement que les coffres qui contiennent déjà une KB OKB.
- **Réexamen.** Si la détection d’outils produit trop de questions inutiles.

## D25 — Application web complète, approbation par présence humaine

- **Problème.** Le lecteur 0.3 était en lecture seule ; il fallait une vraie
  alternative au terminal sans affaiblir l’approbation humaine.
- **Décision.** `okb serve` sert une application sans framework (`web/`) et une API
  JSON (`src/web/api.ts`) : jeton par session pour toute écriture, Host exact,
  même origine, CSP stricte, Markdown assaini. Approuver depuis la page exige une
  confirmation que l’agent ne peut pas donner : dialogue natif macOS, sinon question
  dans le terminal de `okb serve`, sinon la commande à lancer. Le hook refuse les
  appels scriptés à l’endpoint et les clics scriptés sur le dialogue. La
  configuration est relue à chaque requête.
- **Conséquence.** Limite assumée : un logiciel qui contrôle souris et clavier
  pourrait cliquer à la place de la personne (même limite que le terminal).
- **Réexamen.** Si OKB doit tourner sur un serveur partagé : il faudrait une vraie
  authentification, hors périmètre.

## D26 — Le plugin dans l’interface de Claude Code

- **Décision.** Un module de hooks (`plugin/hooks/okb-ui.tsx`) ajoute une entrée de
  barre d’état (`📚 kb · 🎯 focus · 📥 inbox · ⏳ à relire`), la commande `/okb`
  (panneau avec raccourcis qui remplissent le prompt) et une notification quand une
  proposition arrive. Les choix des skills passent par des boutons (AskUserQuestion).
- **Réexamen.** Selon l’évolution de l’API des modules de Claude Code.

## D27 — Installation et documentation pour les personnes

- **Décision.** `scripts/install.sh` vérifie Node, compile dans le dossier du
  produit puis lance `okb init` ; `okb update` met à jour moteur et plugin ;
  `okb doctor --fix` répare plugin, commande `okb`, marqueur et focus. La
  documentation sépare le guide utilisateur (`docs/guide/`, en français) de la
  documentation technique (`docs/dev/`) ; captures d’écran faites sur la KB fictive.
- **Réexamen.** Si le dépôt devient public : publier sur npm (`npm install -g okb`)
  et adapter le guide.

## D28 — Une KB pour chaque repo de code

- **Problème.** Arriver sur un repo d’entreprise sans rien en savoir : lire le code
  « au hasard » donne un résumé qui oublie l’important, et ce qu’on apprend ensuite
  (tickets, réponses d’un senior) se perd. Le dossier v2 exigeait de relire chaque
  bloc de chaque source : impraticable sur des centaines de fichiers.
- **Décision.** `okb repo` : carte déterministe (aucune IA, aucune exécution),
  plan de lecture par niveaux sous budget, 25 questions d’onboarding fixes,
  agents de lecture par zone dont chaque citation est vérifiée, dossier v3 cité
  `fichier:lignes` converti en v2 (même rendu, même revue, même approbation),
  schémas dont chaque boîte pointe vers un chemin réel, fraîcheur par commit,
  enrichissement après ticket, paysage multi-repos. Les réponses humaines sont des
  sources datées, jamais un prérequis. KB de travail `kb.confidential` par défaut.
  Une commande lancée dans un repo documenté vise sa KB. Voir [REPOS.md](REPOS.md).
- **Conséquence.** La lecture prioritaire et la couverture sont mesurées et
  affichées ; l’inconnu reste visible avec à qui demander. Rien n’est écrit dans le
  repo de l’entreprise.
- **Réexamen.** Si une équipe veut partager sa KB : export dans `docs/` du repo, sur
  demande explicite. Si la détection par motifs rate trop de cas sur un écosystème :
  ajouter un détecteur dédié plutôt que des règles générales.

## D29 — Catégories de notes et graphe

- **Problème.** Une KB qui grandit devient illisible sans repères visuels ; Obsidian
  donnait un graphe, mais sans connaître les types de notes d’OKB.
- **Décision.** Neuf catégories fixes (concept, comprendre, faire, process et outils,
  cas et retours, décisions, réunions et sources, parcours, autres), une couleur et un
  emoji chacune, partout (graphe, notes, recherche, relecture, terminal). La catégorie
  est **déduite** (choix explicite `x_okb.category`, puis modèle, type, dossier) : rien
  n’est écrit dans les notes, et renommer ou recolorer ne réécrit rien. Surcharges par
  KB dans `.okb/categories.yaml`. Changer la catégorie d’une note passe par une
  proposition. Nouveaux modèles `tutorial`, `client-case`, `path`. Graphe calculé à
  partir des liens Markdown analysés (pas de recherche de texte), affiché en canvas avec
  d3-force (déjà présent via Mermaid, déclaré en dépendance directe).
- **Conséquence.** Les rétroliens deviennent exacts. Obsidian est facultatif.
- **Réexamen.** Au-delà de quelques milliers de notes : rendu WebGL ou agrégation par zone.
- **Mise en page (ajout).** Thèmes détectés par Louvain (modularité, déterministe,
  côté serveur, `src/kb/communities.ts`), mise en page à deux niveaux (« group in a
  box ») : les thèmes d’abord, en disques proportionnels à leur taille, puis les notes
  autour de leur thème avec des forces de type ForceAtlas2 (répulsion pondérée par le
  degré, liens internes courts et forts, liens entre thèmes longs et faibles) ; notes
  sans lien sur un anneau extérieur ; calcul avant affichage. Titres placés sans
  chevauchement (les plus reliés d’abord, les points comme obstacles).
- **Nom des thèmes (ajout).** Le nom de la note la plus reliée donnait des thèmes
  peu clairs (« Affaire », « Cockpit ») ou tronqués. Un thème prend désormais le nom
  de la note qui l’explique (`src/kb/themes.ts`) : une note explicative (guide,
  parcours, procédure, process) reliée à au moins la moitié du thème, choisie par
  couverture × part de ses liens restés dans le thème (une page d’accueil reliée
  partout perd) ; sinon un tag porté par 60 % du thème et à 80 % seulement par lui ;
  sinon une note explicative reliée à un quart du thème ; sinon la note la plus
  centrale. Titre réduit à son sujet (sans emoji, sans sous-titre). La résolution de
  Louvain reste à 1 : des valeurs plus hautes découpaient mieux une KB et moins bien
  une autre, sans règle stable.

## D30 — Utilisation, coûts et boucle d'amélioration

- **Problème.** On ne savait ni ce que coûte OKB, ni si sa rédaction convient,
  donc on optimisait à l'aveugle. Un suivi qui dépense des tokens à chaque
  session coûterait plus qu'il ne rapporte.
- **Décision.** Tout est lu dans des fichiers locaux, sans modèle :
  - les journaux de Claude Code, découpés en tâches OKB : chaque réponse comptée
    une fois, sous-agents rattachés, développement d'OKB exclu, prix publics
    datés ;
  - les propositions et leurs reçus : changements écartés, annulations, délai de
    relecture, notes retouchées à la main ;
  - un journal d'une ligne par commande `okb`, sans arguments ;
  - les retours de la personne (`okb feedback`).

  `okb usage`, la page Utilisation et `okb report` les montrent, sans texte de
  note. Le JSON des commandes est compact quand Claude le lit. Un banc d'essai
  hors `release:check` (`scripts/bench.mjs`) mesure coût et qualité d'un vrai
  workflow sur des cas fictifs aux faits connus.
- **Conséquence.** Une optimisation (modèle des sous-agents, sortie raccourcie)
  se décide sur des chiffres : coût, faits retrouvés, erreurs, jugement à
  l'aveugle. La rédaction reste sur le modèle principal. Voir
  [COSTS.md](COSTS.md).
- **Réexamen.** Si Claude Code change le format de ses journaux, le lecteur
  (`src/usage/claude-logs.ts`) ignore ce qu'il ne comprend pas : les chiffres
  baissent, sans plantage.

## D31 — Les KB : choisies, nommées, retirables, convertibles

- **Problème.**
  - L'installation créait une KB d'office et l'assistant pré-remplissait son nom.
  - Un ancien profil restait actif sans que la personne sache d'où il venait.
  - Le nom de la personne était lu dans Git.
  - Retirer une KB s'appelait « archiver ».
  - Rien ne convertissait une ancienne KB.
  - Les mises à jour exigeaient l'accès au dépôt privé.
- **Décision.**
  - Aucune KB par défaut. « Aucune KB connectée » s'affiche là où apparaît le nom
    de la KB.
  - Le nom d'une KB est toujours demandé. Aucun nom de personne n'est lu :
    `human:me` par défaut.
  - `okb kb add` connecte un dossier (marqueur `.okb/owner.yaml`, aucune note
    écrite). `okb kb remove` déconnecte, les notes restent.
  - La conversion est découpée en deux.
    - Le jugement (modèle, titre, description d'une phrase tirée de la note)
      revient à Claude, dans un plan JSON.
    - L'application est mécanique (`src/kb/convert.ts`) : liens portables, puis
      en-têtes, puis rangement avec réécriture des liens. Elle produit une seule
      proposition atomique.
  - La conversion ne réécrit jamais le corps d'une note.
  - `okb update --from <paquet>` met à jour sans accès au dépôt.
- **Conséquence.**
  - Une ancienne KB devient une KB OKB propre en une relecture, réversible avec
    `okb undo`.
  - La réécriture d'une note dans son modèle reste un choix, note par note
    (`okb revise`).
- **Réexamen.** Pour une très grande KB (des milliers de notes), découper la
  proposition par dossier.

## D32 — Espace de travail, périmètre et tickets suivis

- **Problème.**
  - Une KB qui documente vingt repos noie la réponse : une recherche ramène
    les notes de tous les repos, et Claude ouvert à la racine du dossier ne
    sait pas lequel est visé.
  - Ce qu'un ticket apprend (décisions, pièges) se perdait avant la fin.
  - Ce qui dépasse un repo (règle métier, fonctionnalité) n'avait pas de chemin
    vers la partie commune.
  - Le produit ne devait rien supposer d'une organisation de dossiers.
- **Décision.**
  - Un **espace de travail** relie un ou plusieurs dossiers à une KB. Il est
    créé en une commande ; les préfixes de tickets sont appris des branches.
  - Un **périmètre** : le dossier du repo décide, sinon le choix mémorisé, que
    met à jour un message nommant un seul repo ou un ticket. Brief court au
    démarrage, recherche classée par périmètre, ligne d'état.
  - Un **ticket suivi** sans IA : départ, branche, commits copiés dans un
    journal, notes de décision ou de piège. Un rappel d'une ligne après chaque
    commit fait dans Claude Code.
  - À la fin, une proposition à deux niveaux : l'espace du repo et la partie
    commune. Une note commune n'est jamais rattachée à un repo.
  - Tout est local ; rien n'est écrit dans les repos.
- **Conséquence.** Moins de contexte et plus juste ; la mémoire d'un ticket ne
  dépend plus de la fin de session ; zéro token pour le suivi.
- **Réexamen.** Si la bascule par message se trompe trop souvent (noms de repos
  ambigus), passer à une confirmation par bouton ; si une équipe veut partager
  la KB, étudier une KB synchronisée par équipe.

## D33 — Les KB restent locales : OKB ne fait plus de Git

- **Problème.** L'assistant proposait un historique Git et un dépôt GitHub, et
  chaque approbation devenait un commit. La personne veut des KB locales ; un
  remote ou un push n'est pas le rôle d'OKB.
- **Décision.**
  - OKB ne crée plus de dépôt Git, ne commite plus, ne propose plus GitHub ni
    `git push`.
  - `git.autoCommit` est ignoré et retiré des réglages. L'annulation repose sur
    les reçus et sauvegardes d'OKB.
  - Une KB que la personne versionne elle-même reste sous Git, sans aucun commit
    d'OKB.
  - Le diagnostic garde une alerte pour une KB confidentielle synchronisée par un
    cloud ou munie d'un remote.
- **Conséquence.** Les profils existants restent valides ; plus rien ne sort de
  la machine par OKB.
- **Réexamen.** Si un partage d'équipe est demandé, il passera par un outil
  choisi par la personne, pas par un push d'OKB.

## D34 — Trois types de KB : sujet, repo, espace de travail

- **Problème.** Une KB unique pour toute une équipe convient quand les repos se
  parlent, mais pas pour un repo isolé ou plus confidentiel. Et rien ne guidait
  le choix.
- **Décision.**
  - `kb.kind` : `topic`, `repo` (notes à la racine) ou `workspace`
    (`repos/<id>/` et une partie commune). Il est demandé à la création ; pour une
    ancienne KB, il est déduit.
  - `okb repo add` conseille selon le contexte :
    - des repos voisins → créer un espace de travail ;
    - un repo seul → une KB de repo ;
    - un repo dans un espace → la KB de cet espace.
  - Une KB de repo dans un espace est rattachée : résumé, recherche et fin de
    ticket lisent aussi la partie commune de l'espace.
  - `okb kb merge` fusionne une KB de repo dans un espace, par une proposition,
    puis déplace l'état.
  - Le graphe web d'un espace a une vue d'ensemble (une bulle par repo) et un
    périmètre. Les tickets ont leur propre catégorie.
- **Conséquence.** Le bon rangement dès la création, sans migration forcée
  ensuite.
- **Réexamen.** Si les repos rattachés deviennent la règle, envisager une
  recherche multi-KB générale.

## D35 — Installation guidée : OKB regarde avant de proposer

- **Problème.**
  - Mettre OKB en place demandait de connaître l'ordre des commandes
    (`kb add`, `workspace add`, `/okb:convert`) et quel type de KB choisir.
  - Sur le terrain, la personne ne savait pas par où commencer pour son ticket.
- **Décision.**
  - `okb start` lit la situation sans IA et sans rien écrire :
    - KB, espaces et repos connus ;
    - dossier de repos jusqu'à deux niveaux, dossier par dossier ;
    - anciennes KB, sous Git ou non ;
    - groupes par équipe, plugin.
  - Il en tire des recommandations et un plan de commandes exactes ; dans le
    terminal, il l'exécute après une confirmation.
  - Le skill `okb-setup` le lit, pose seulement les questions utiles (le nom de
    la KB n'est jamais deviné), montre l'aperçu, puis lance le plan.
  - Un espace existant est vérifié : les repos du dossier qui manquent sont
    ajoutés.
  - Un dossier de notes n'est jamais pris pour un repo, et Claude n'y propose
    pas l'onboarding.
- **Conséquence.** Une phrase suffit pour démarrer ; le plan reste visible et
  modifiable avant tout changement.
- **Réexamen.** Si des organisations plus profondes que deux niveaux sont
  courantes, étendre la recherche ou demander le dossier.


## D36 — Le cerveau et le Zoom

- **Problème.**
  - Les notes d'un repo, d'un produit et les notes globales se mélangeaient ;
    on ne savait pas où ranger une information ni où la retrouver.
  - Le rangement par type de note (`guides/`, `concepts/`) ne suit pas la façon
    dont on travaille (produit → repo → ticket).
- **Décision.**
  - Un **cerveau** (`kb.brain`) a cinq tiroirs numérotés : `0 Entrée`,
    `1 Écosystème`, `2 Produits`, `3 Boîte à outils`, `4 Activité` (les noms
    changent selon le préréglage : travail, projets, sujets, carrière).
  - Le **Zoom** : produit → `Code/<repo>` → `Tickets/<année>`. Chaque dossier a
    sa page « en 5 min » (`<dossier>/<dossier>.md`).
  - Un **moteur d'adresse** calcule le chemin exact de chaque type de note
    (~90 types) : la même note est toujours rangée au même endroit.
  - **L'ascenseur** : un fait va au niveau le plus bas qui le porte ; une leçon
    monte au niveau le plus haut où elle reste vraie.
  - Chaque nouvelle note reçoit un identifiant stable (`x_okb.id`) et un fil
    d'Ariane ; les pages des sujets manquants sont créées dans la même proposition.
  - Une KB classique reste inchangée jusqu'à `okb brain migrate`, qui prépare
    une proposition de déplacements (liens réécrits) que la personne approuve.
- **Conséquence.** Une adresse prévisible pour 3 000 notes et plus ; Claude lit
  le contexte vertical d'un sujet (`okb brain context`) au lieu de tout chercher.
- **Réexamen.** Si un métier ne tient pas dans cinq tiroirs, ajouter un préréglage.

## D37 — Demander avant d'écrire

- **Problème.** Écrire une note coûte des tokens et peut être inutile ou en
  double ; une écriture automatique fait perdre le contrôle.
- **Décision.**
  - Claude montre d'abord une **carte de suggestion** (`okb suggest add`) : type,
    place exacte, raison, notes qui couvrent déjà le sujet, recommandation,
    pertinence /100, coût estimé.
  - Le **oui** est enregistré par les hooks du plugin, à partir de ce que la
    personne a fait (son clic dans AskUserQuestion, son « oui », un identifiant
    tapé) ; un appel d'outil ne peut pas l'enregistrer (le garde le refuse).
  - Dans un cerveau, `okb ingest` et `okb repo write` lancés par Claude refusent
    une note sans suggestion acceptée qui couvre son chemin.
  - Un budget quotidien (`budget.daily`, 50 000 tokens par défaut) ; au-delà,
    il faut demander.
  - Les cartes à chaud seulement au-dessus de 80 de pertinence ; le reste en fin
    de ticket ou de session (`suggest.mode`).
- **Conséquence.** 0 note sans oui, mesuré par `okb metrics`.
- **Réexamen.** Si les cartes gênent, monter le seuil ou passer en mode session.

## D38 — Noter les notes

- **Décision.** Chaque note a deux notes sur 100, calculées sans IA :
  **qualité** (structure, sources, clarté, liens, justesse donnée par le
  relecteur) et **valeur** (lectures, recherches, liens entrants, 👍/👎).
  Global = 60 % qualité + 40 % valeur, affiché en étoiles et en pourcentage.
- **Conséquence.** La revue de la semaine montre les notes faibles ; la
  recherche favorise un peu les bonnes notes.

## D39 — Un stockage robuste sans Git

- **Problème.** OKB n'utilise plus Git pour les KB (D33) : il fallait quand même
  un historique, une corbeille et des sauvegardes.
- **Décision.**
  - L'historique d'une note vient des reçus et des copies `.bak` ; les
    déplacements sont notés dans la proposition, l'historique les suit.
  - Corbeille de 30 jours à partir des reçus ; une restauration est une proposition.
  - Sauvegardes quotidiennes par liens physiques, avec manifeste sha256,
    rotation 7 jours / 4 semaines / 12 mois, vérification, restauration dans un
    nouveau dossier seulement. La clé d'approbation n'est jamais copiée.
  - `okb brain check` : copies de synchronisation, identifiants en double, liens
    cassés, notes déplacées, chiffrement du disque, sauvegardes.

## D40 — Retrouver en trois secondes

- **Décision.**
  - MiniSearch en mémoire : fautes de frappe, accents, pluriels, débuts de mots,
    titres et alias favorisés, recherche dans les deux langues (lexique FR/EN).
  - Les messages d'erreur sont normalisés : une erreur déjà vue retrouve sa note.
  - Les notes viennent à soi : celles d'un fichier ouvert, celles d'une erreur.
  - Une recherche vide deux fois devient une suggestion.
  - L'index et les liens entre notes sont calculés une fois par version de la KB.
- **Conséquence.** p95 de 6 ms sur 4 600 notes ; 93 % de bonnes notes dans le
  top 3 avec une faute de frappe (jeu de démonstration).

## D41 — Modèles, exemples et relecture qualité

- **Décision.**
  - Un catalogue d'environ 60 modèles, chacun commençant par « En bref » et avec
    sa grille de vérification ; des exemples parfaits fictifs que Claude imite.
  - Les diagrammes Mermaid sont vérifiés avant d'enregistrer une proposition.
  - Un agent `okb-quality-reviewer` note le brouillon sur la grille ; sa note de
    justesse est gardée (`x_okb.review`).
  - Un profil de lecture règle quatre curseurs à la fois (niveau, schémas,
    détail, exemples).
  - Des évaluations `claude plugin eval` (étiquettes `quality`, `consent`)
    se lancent sur Sonnet et sur Opus.

## D42 — Des modules : le cœur et le module développeur

- **Décision.**
  - Le plugin `okb` est le cœur ; `okb-dev` est un module qui dépend de lui
    (`dependencies: ["okb"]`), dans la même marketplace.
  - Le module développeur a huit compétences : produit, repo, ticket,
    expliquer, déboguer, pré-revue, commit/PR, support.
  - `okb dev review` et `okb dev ship` donnent à Claude des faits sans IA
    (règles d'équipe, pièges, style de commit, modèle de PR).
  - Les mentions « généré avec » et les co-auteurs sont désactivées par défaut
    dans ce que Claude rédige (`dev.attribution`).
  - L'installation passe par Claude seulement : ajout de la marketplace, plugin,
    puis « configure OKB » qui installe le moteur (`engine.sh`).
- **Réexamen.** D'autres modules (support, formation) quand le cœur sera stable.

## D43 — Apprendre et la carrière

- **Décision.**
  - Les cartes de révision sont calculées à partir des notes (fiches concepts,
    lignes « Q : … — R : … ») ; l'état de révision (FSRS, `ts-fsrs`) vit dans le
    dossier d'état d'OKB, jamais dans la KB.
  - Carte des compétences par sujet, quiz sur un repo ou un produit, objectifs
    d'apprentissage.
  - Carrière : histoires STAR avec preuves, retours, objectifs, préparation des
    entretiens. `okb career check` liste ce qui partirait de l'entreprise
    (produits, clients, repos, tickets, emails, liens, montants) ;
    `okb career export` copie seulement quand plus rien ne fuit.

## D44 — Confidentialité

- **Décision.**
  - `x_okb.confidentiality: secret` (🔒) : la recherche lancée par Claude laisse
    la note de côté, et un hook refuse à Claude de lire le fichier.
  - La personne l'ouvre à Claude en la nommant dans son propre message : le hook
    l'enregistre pour 30 minutes. Un appel d'outil ne peut pas le faire.
  - Les données personnelles (emails, téléphones, IBAN, numéros d'identité, de
    carte) sont signalées dans la proposition, pas refusées : la personne décide.
  - Marquer une note passe par une proposition (`okb secret set`).
- **Limites.** Un garde contre la lecture accidentelle, pas un coffre-fort : les
  lecteurs courants du shell et `Read` sont couverts.

## D45 — Les vues dans l'application

- **Décision.** Les index, « Maintenant », les glossaires et le graphe par niveaux
  sont calculés dans l'application web et la CLI, pas écrits dans la KB.
  Le mode `files` les écrit, mais par une proposition comme le reste.
- **Conséquence.** Aucune écriture de fond ; la KB ne contient que des notes.

## D46 — Mesurer la 1.0

- **Décision.** `okb metrics` mesure en local et sans IA les critères de la 1.0 :
  contrôle, rangement, recherche (top 3 et vitesse), qualité, coût du résumé de
  démarrage, robustesse, discrétion, usage. La bêta de deux semaines le relit
  chaque semaine.

## Travail restant après la 1.0 (noté le 8 octobre 2026, rien de commencé)

Décidé (voir D47) : le site local d'abord ; l'IA par Claude Code local ou par
une clé. À décider : l'interface en React + TypeScript, migrée page par page.

Pistes, par ordre proposé :
- **1.1** : la page Repos montre les repos d'un cerveau non enregistrés sur la
  machine ; une page Modules ; la phrase courte obligatoire des concepts (bulle
  au survol) ; un bouton Traduire (vue en cache, enregistrement par proposition) ;
  une page « Utiliser OKB dans Claude Code » avec installation en un clic ; le
  niveau de connaissance de chaque repo (barre qui baisse quand le code change).
- **1.2** : la nouvelle page Notes (arbre, filtres, aperçu) ; une recherche
  hybride (mots, sens par embeddings locaux, structure) et « Demande à ton cerveau » ;
  XP et badges personnels.
- **1.3** : des diagrammes d'architecture calculés depuis le code (correspondance
  appels ↔ routes, événements, preuves des deux côtés), auto-évalués et mesurés
  sur un jeu de test multi-repos ; l'examen de connaissance d'un repo ; exporter,
  comparer et fusionner des KB.
- **2.0** : un serveur d'équipe (comptes, partage, relecture commune, réputation
  des relecteurs, classements à activer par l'équipe).

## D47 — Local d'abord, l'IA de deux façons, des modules par profil

- **Décision (8 octobre 2026, à implémenter).**
  - Le site reste **local d'abord** ; le partage passera par un échange de
    packs, puis par un serveur d'équipe auto-hébergé.
  - Le site appelle l'IA **de deux façons** : Claude Code installé sur la machine
    (l'abonnement de la personne), ou une clé d'API (Claude Agent SDK), derrière
    une même couche « fournisseur ».
  - Un **module par profil** (dev aujourd'hui ; devops, commercial ensuite) : le
    moteur et le site connaîtront les modules, pas seulement le plugin Claude.
  - Prévoir tôt un **identifiant stable par personne** et un **rôle** sur les notes
    et les relectures, pour le travail d'équipe.
- **Conséquences pour les fonctions à venir.**
  - **Traduire** : sur un clic seulement, gardé en cache, sections modifiées
    seules retraduites, petit modèle.
  - **Bulle des concepts** : affiche seulement la phrase courte de la fiche.
  - **Diagrammes** : vérifiés après génération (noms compréhensibles, schéma
    cohérent) en plus des preuves.


## D48 — Phase A de la 1.1 : les moteurs (nuit du 8 au 9 octobre 2026)

> Décisions prises en autonomie (carte blanche), **à valider** à la relecture.
> Spec : [specs/2026-10-09-phase-a-moteurs.md](specs/2026-10-09-phase-a-moteurs.md).

- **Modules** (`src/modules/catalog.ts`) : `core` (toujours), `dev` (disponible),
  `devops` et `sales` (prévus). Réglage global `modules.enabled`, `['dev']` par
  défaut pour ne rien casser. `featureOn(feature)` combine « activé » et « droit » ;
  `entitled()` est vrai pour un module gratuit : une licence payante s'ajoutera
  derrière, sans changer les appels. `okb modules`, `GET /api/modules`, installation
  du plugin Claude d'un module sur un clic (`POST /api/modules/install`).
- **Identité** (`src/identity/person.ts`) : `person.id` aléatoire (`p-` + 10
  caractères), créé une fois, jamais tiré d'un nom ; `person.role` déclaré. Les
  reçus et les décisions de suggestions le portent. `okb whoami`. Les réglages
  globaux se changent maintenant sans KB.
- **Repos d'un cerveau** : la page Repos reçoit aussi les dossiers `Code/<repo>`
  non reliés (`unlinked`) et `POST /api/repos/link` les relie.
- **Niveau de connaissance** (`src/knowledge/level.ts`, sans IA) : questions 30,
  pages 25, code lu 20, mémoire du travail 15, qualité 10. Une page changée vaut
  0,6, obsolète 0,3. Paliers Découverte · Utilisable · Solide · Expert · Référence.
  **Un repo non relié est mesuré sur ses notes et plafonné à « Solide »** : personne
  ne les a vérifiées contre le code. Les 3 manques qui rapportent le plus.
  `okb repo level`.
- **Concepts « En une phrase »** (`src/concepts/one-liner.ts`) : la phrase vit dans
  la fiche (section « En une phrase », sinon « En bref »), 3 à 25 mots ; c'est le
  seul texte de la bulle ; sans elle, le mot reste un lien. −4 points de structure
  sans phrase ; `okb concepts check [--suggest]`.
- **Fournisseur d'IA** (`src/ai/provider.ts`) : `claude -p` sans outils, sans
  réglages ni plugins, sans session gardée, modèle `haiku` ; ou l'API avec
  `ANTHROPIC_API_KEY` ; `OKB_AI=fake` pour les tests. `OKB_HEADLESS=1` fait taire
  les hooks de contexte ; **les gardes (approbation, 🔒) ne se taisent jamais**.
  L'appel réel n'a pas pu être vérifié dans la session de nuit (connexion Claude
  expirée pour un processus enfant) : à essayer.
- **Traduction** (`src/translate/translate.ts`) : sur demande, « En bref » d'abord ;
  code, Mermaid, citations et notes de bas de page intacts ; cibles de liens et
  code protégés (un bloc qui perd une cible garde le texte source) ; cache par
  section sur le disque, 30 jours sans lecture ; coût annoncé et budget du jour
  partagé avec les cartes ; une note 🔒 seulement après confirmation, une note qui
  contient un secret jamais ; « enregistrer comme note » = une proposition.
- **Tests sous charge** : les 6 scénarios de bout en bout (des dizaines de
  processus Git et `okb`) ont un délai explicite de 180 s ; les scans d'un espace
  de travail tournent par 4. Piste : moins d'appels Git au scan.

## D49 — Phase B : la refonte visuelle en React (nuit du 8 au 9 octobre 2026)

> Prise en autonomie, **à valider**.

- **Méthode** : audit Impeccable de l'ancien site (9/20,
  [audit](../design/audit-2026-10-09.md)), `PRODUCT.md` (faits supposés marqués),
  direction tirée par Impeccable parmi sept mondes de la culture des utilisateurs
  (graine 25e87c45) : **le plan de métro**. Relecture de finition « à corriger » →
  un lot de corrections, puis `DESIGN.md` écrit depuis le résultat.
- **Le monde** : rail bleu marine, sol blanc froid, les catégories de notes sont les
  lignes, les notes les stations ; jaune signal réservé (action principale, « tu es
  ici ») ; Fira Sans et Fira Code servies par OKB ; lignes de 3 px, pastilles,
  stations.
- **La technique** : `web-app/` (React 19, TypeScript, Vite, TanStack Query et
  Virtual, Radix, cmdk, lucide), construit dans `web/app/` (ignoré par Git, inclus
  dans le paquet). Le serveur sert la nouvelle page sur `/` et l'ancienne sur
  `/classic`. Mêmes adresses `#/…` qu'avant. Aucune dépendance nouvelle à
  l'exécution : React est compilé dans la page.
- **Pas encore refaites** : réglages, graphe, historique, revue de la semaine,
  santé, outils (toujours dans `/classic`).
- **Tests** : routeur, composants signature (ligne de la note, ligne de
  connaissance), lecteur (concepts, fil d'Ariane), et toutes les clés de texte de
  `web-app` présentes en français et en anglais.

## D50 — Phase C : retrouver par le sens, demander à son cerveau

- **Sens sans modèle** (`src/find/meaning.ts`) : racines des mots (français et
  anglais) et familles de mots du travail, dans un second index fusionné avec la
  recherche par mots (les mots exacts gardent la tête). Jeu de mesure
  `tests/fixtures/reformulated` : 75 % → 95 % dans le top 3 ; 10 questions écrites
  après le réglage : 100 %. Un vrai modèle d'embeddings local pourra s'ajouter derrière.
- **Demander** (`src/find/answer.ts`, page `#/ask`) : les passages qui répondent,
  numérotés ; sur demande, une réponse rédigée seulement à partir d'eux, chaque
  phrase citée [n], dans le budget du jour, jamais une note 🔒 ni un secret.

## D51 — Progression personnelle et packs (fin de la nuit, 8–9 octobre 2026)

> Prises en autonomie, **à valider**.

- **Progression** (`src/progress/progress.ts`, `okb progress`, Aujourd'hui et
  Apprendre) : XP pour lire (1), réviser (2), trancher une carte (3), écrire une note
  (6) ; chaque geste du même genre vaut 7 % de moins que le précédent le même jour ;
  une note relue le même jour compte une fois. Niveau n à 25 × n × (n − 1) XP.
  Badges bronze, argent, or : lecteur, réviseur, décideur, bâtisseur, régulier.
  Tout est local et personnel ; réglage `progress.show`. Pas de classement : il
  viendra avec l'équipe (2.0), à activer par elle.
- **Packs** (`src/packs/pack.ts`, `okb pack`) : un fichier `.okbpack.json` avec les
  notes d'un sujet et leur auteur ; jamais une note 🔒, privée ou contenant un
  secret. Comparer (en plus, différentes, identiques) ; fusionner = une proposition
  qui ajoute seulement ce qui manque, en gardant `generated.by` et `x_okb.pack`.
  Une note différente n'est jamais écrasée.

## D52 — Phase D : l'architecture calculée depuis le code (8 octobre 2026, soir)

> Prises en autonomie, **à valider**. Spec : `docs/dev/specs/2026-10-08-phase-d-diagrammes.md`.

- **Le modèle sans IA** (`src/arch/model.ts`) : le scan détecte en plus les appels
  HTTP sortants (fetch, axios, got, ky, requests, RestTemplate, WebClient) avec la
  variable de base d'URL, et les événements publiés ou écoutés (Kafka, RabbitMQ).
  Les repos sont reliés par correspondance : même méthode et même chemin normalisé,
  même sujet d'événement, même paquet, même nom de service. Chaque lien a ses
  preuves des deux côtés et une confiance (sûr, probable, à confirmer).
- **Jamais de trait inventé** : un appel que personne ne sert devient une question
  (« qui sert `POST /refunds` ? »). Jeu de 5 repos fictifs : 0 lien inventé, 0 manqué.
- **Des vues lisibles** (`src/arch/views.ts`) : contexte, conteneurs (12 boîtes au
  plus), parcours ; un nom métier (titre du README, sinon description) avec l'id en
  petit ; un verbe sur chaque flèche (`POST /orders` → « crée orders »).
- **L'auto-évaluation** (`src/arch/check.ts`) : note sur 100 (preuve, verbe, nom
  lisible, boîte isolée, taille) ; sous 80, les manques sont montrés, pas le schéma.
- **Pour Claude** : `okb arch [containers|context|flow] [--mermaid] [--json]` et
  l'agent `okb-dev:okb-architecture-reviewer`, appelé par les compétences produit et
  repo avant de proposer un schéma. Route web `GET /api/repos/arch`.
- La vue web (plan du système) attend l'identité visuelle 1.5.

## D53 — Identité visuelle 1.5 : Atelier et Classique, au choix (9 octobre 2026)

> Décidée avec l'utilisateur, sur maquettes. Spec :
> `docs/dev/specs/2026-10-08-identite-1-5.md`. Remplace la direction « plan de
> métro » de D49, refusée (« je préférais largement l'ancienne »).

- **Deux thèmes au choix**, chacun clair, sombre ou auto : **Atelier** (par défaut,
  un outil de développeur : barre d'icônes, barre d'état, monospace pour chemins et
  nombres, titres en `// commentaire`) et **Classique** (l'interface d'origine,
  verte et aérée). Même structure, mêmes composants ; seuls les jetons et quelques
  touches changent. Menu **Apparence** et palette ⌘K.
- **Barre latérale repliable** (icônes seules ↔ icônes et textes), bouton et ⌘\ ;
  choix retenu, sinon repliée en Atelier et dépliée en Classique.
- **Logo : la note liée** `o—•`, en dégradé, par défaut. Le choix n'étant pas
  arrêté, les quatorze propositions des deux séries restent toutes disponibles
  dans le menu Apparence, chacune en dégradé ou à plat ; archive dans
  `docs/design/logos/`.
- **Clair par défaut** (sombre et auto au choix) ; le bouton qui replie la barre
  est en haut, à côté du logo.
- **Des dégradés comme dans le logo**, avec retenue : bouton principal, barre
  d'état, page courante, compteurs, accueil, niveaux. Pas sur les données.
- Polices servies par OKB : IBM Plex Sans, Inter, JetBrains Mono (Fira retirée).

## D54 — 1.5 finale : une police, un style, toutes les pages (9 octobre 2026)

> Décidée avec l'utilisateur sur la maquette `interface-1-5.html` (« Inter,
> dégradé, garder les 2 thèmes, clair par défaut ; fais ça pour toutes les
> pages »). Corrige D53, dont le premier jet mélangeait deux polices, des titres
> en `// commentaire` et du plat à côté du dégradé.

- **Une seule police, Inter**, dans les deux thèmes ; la chasse fixe ne sert qu'au
  code (blocs, code en ligne, commandes à copier). IBM Plex Sans n'est plus servie.
- **Dégradé ou à plat, partout pareil** : un seul réglage (`data-style`, clé
  `okb-style`) pour le logo, les boutons, la page courante, les badges, les
  remplissages, l'accueil et la barre d'état ; dégradé par défaut. L'ancien choix
  « logo à plat » est repris.
- **Les deux thèmes, la même structure** (mêmes tailles, arrondis 8 · 10 · 14) ;
  seules les couleurs changent. Plus de `//`, de `~/` ni de types en étiquettes de
  code : **chaque type de note a son icône** dans un carré teinté de sa couleur ;
  un type ajouté par une KB garde son emoji.
- **Toutes les pages dans la nouvelle interface**, regroupées en 13 destinations
  (Aujourd'hui, Cerveau, Graphe, Demander, À valider, Repos, Apprendre ; Outils,
  Entretien, Modules, Claude Code, Réglages, Aide), chacune avec des onglets qui ont
  leur adresse. Les anciennes adresses ouvrent le bon onglet ; une adresse inconnue
  ouvre Aujourd'hui. L'ancienne interface n'est plus liée ; `/classic` reste servi
  pour la transition.
- **Cerveau** : arbre des dossiers dépliable à tous les niveaux ou rangement par
  types, liste groupée par type ou par dossier et repliable, page d'un dossier
  (sa page de 5 minutes, ses sous-dossiers) quand aucune note n'est ouverte ;
  lecteur refait (titre, résumé, type modifiable, graphe local, versions).
- **Graphe** porté en TypeScript (`web-app/src/graph/GraphView.ts`, d3-force
  embarqué) : halos de thème teintés, points lumineux pour les notes très reliées,
  « vu d'en haut » en bulles.
- Relecture : la sélection fichier par fichier de l'ancienne page revient
  (décocher un fichier avant d'approuver).
- **Réexamen** : si l'utilisateur veut revoir une page précise, ou retirer
  `/classic` une fois la transition finie.

## D55 — 1.5 terminée : bulles, graphe net, examen, partage, explorateur complet (9 octobre 2026, soir)

> Demandé par l'utilisateur : « la bulle au survol d'un concept, sans bâcler ; trop
> de flou sur le graphe ; finalise à 100 % la 1.5 ». Décisions prises seul, pendant
> une session autonome, à relire.

- **Bulle des concepts** : un lien que la note fait déjà vers une fiche concept
  reçoit la bulle (c'était le cas manquant : les notes générées lient leurs
  concepts). La bulle attend que le pointeur se pose (140 ms), se ferme 220 ms après
  l'avoir quitté, passe directement d'un mot à l'autre, suit le défilement, s'ouvre
  au clavier et au premier toucher sur un téléphone.
- **Graphe sans flou** : thèmes en disques à plat au bord net, notes très reliées
  cerclées de leur couleur, bulles « vu d'en haut » opaques, cartes flottantes
  pleines. Plus de dégradé radial ni de verre dépoli sur le graphe.
- **Examen de connaissance** (§5.1) : les 25 questions d'onboarding et celles de
  l'équipe, répondues **par les notes du repo seulement**, notées contre une
  référence que les notes n'ont pas écrite (réponse attendue, réponse d'une
  personne, lignes de code désignées par l'analyse). Deux appels groupés (répondre,
  puis noter), petit modèle, coût annoncé, budget du jour. Une question sans
  référence n'est pas notée — sinon un repo non relié n'aurait que des échecs
  comptés. Les dix derniers résultats sont gardés dans l'état, hors de la KB.
- **Partager** (§6, étape 1) : page Outils › Partager, export d'un dossier,
  comparaison d'un pack reçu avec l'écart ligne à ligne, fusion par proposition.
- **Explorateur complet** (§3.2) : filtres cumulables (types, statut, qualité,
  date, 🔒), tri, vues liste / tableau / cartes, vues enregistrées et prêtes, notes
  épinglées et récentes (dans ce navigateur), sélection multiple : changer le type
  ou la confidentialité de plusieurs notes en **une** proposition. « / » reste la
  recherche de toute l'application.
- **Titres de propositions lisibles** : l'étiquette d'un changement reste une donnée
  en anglais (reçus, CLI, tests) ; le titre montré est traduit à l'affichage, la note
  par son nom et le type par son libellé.
- **Petits défauts de la nuit** corrigés (M1–M3, M5–M8, M10–M12) : clôtures de code
  longues, code indenté et commentaires gardés à la traduction ; un seul titre ;
  langue de la note ; budget restant ; traduction d'une fiche hors du glossaire ;
  abréviations ; clé d'API en relais de Claude Code déconnecté ; appels à l'IA un
  par un ; points des manques remis à l'échelle ; repos homonymes ; identité lue dans
  le bon dossier OKB. **M4** gardé : le titre et la description partent encore à la
  traduction d'une note toute en code (c'est de la prose). Les appels Git d'une
  analyse ne sont pas mis en cache (7 appels en parallèle, 0,3 à 0,5 s ; un cache
  servirait un état « modifié » périmé après un commit).
- **Version 1.5.0** dans `package.json` et les deux plugins ; rien n'est poussé ni
  tagué sans l'accord de l'utilisateur.

## D56 — 2.0, itération 1 : la confiance d'abord (10 octobre 2026)

**Problème.** L'audit du 9 octobre relevait trois fuites possibles vers l'IA (P1) et une dizaine de défauts d'intégrité (P2). Chaque fonction qui appelait un modèle (traduire, Demander, l'examen) construisait et contrôlait seule ce qu'elle envoyait. Les fichiers d'état lus, modifiés puis réécrits pouvaient perdre une écriture concurrente.

**Décisions.**

- **Une seule porte de sortie vers l'IA** (`src/ai/gate.ts`, F2.0-23). Le message exact est contrôlé en entier : un secret où que ce soit, et rien ne part.
  - Une note 🔒 part seulement avec un accord donné pour son contenu, c'est-à-dire son empreinte. Depuis l'app, l'accord est l'empreinte que l'estimation a montrée, jamais un simple `true`.
  - Le budget est vérifié avant l'appel.
  - L'usage est compté même quand l'appel échoue après avoir consommé des tokens. Le fournisseur joint cet usage à l'erreur.
  - Les files `oneAtATime` restent chez les appelants : la porte n'attend jamais dessus.
  - Corrige F2.0-30, 31, 32 et 37.
- **Un verrou d'état** (`src/util/state-lock.ts`, F2.0-15).
  - Il sérialise les lectures-modifications-écritures d'un même fichier : file d'attente dans le processus, et dossier `<fichier>.lock` entre processus.
  - Il attend jusqu'à 5 s et reprend le verrou d'un processus mort de cet ordinateur. Sinon, il échoue avec `E_CONFLICT` (`stateBusy`).
  - Il protège : le journal des tickets (F2.0-33), la file des suggestions, les cartes et objectifs d'apprentissage, les réglages d'un profil, `config.yaml` et le cache des traductions.
  - Le cache des traductions est fusionné à l'écriture, avec `mergeCache`.
  - Les lecteurs ne prennent pas le verrou : un renommage atomique leur donne toujours un fichier entier.
- **Les autres défauts de l'audit.**
  - F2.0-34 (architecture) :
    - le parcours d'un flux garde l'appel choisi ;
    - une route n'est indexée que pour sa méthode, et seules `route()`, `all` et `use` répondent à toutes ;
    - un appel HTTP se distingue aussi par sa base.
  - F2.0-35 : la clé du cache des scores couvre toutes les notes, le fichier d'événements et le jour.
  - F2.0-36 : la traduction complète d'une note faite seulement de code rend la note entière.
  - F2.0-38 : un pack se compare sans `x_okb.pack` ni `x_okb.id`.
  - F2.0-39 : une carte est notée une fois par affichage, et une nouvelle série repart de sa première carte.
  - F2.0-41 : une erreur de chargement des propositions s'affiche comme une erreur.
  - F2.0-42 : « Aller au contenu » met le focus sans changer d'adresse.
  - F2.0-40 était déjà corrigé dans la 1.5.

**Conséquences.**
- Toute nouvelle fonction qui appelle un modèle passe par `sendToAi`.
- Toute nouvelle écriture d'état en lecture-modification-écriture passe par `withStateLock`.
- 25 tests de plus, dont une reproduction par défaut ; chaque reproduction a échoué avant sa correction.

**Réexamen.**
- Revoir quand l'état opérationnel passera dans SQLite (F2.0-18) : ses transactions remplaceront le verrou pour ces fichiers.
- Revoir si un appelant doit envoyer volontairement une note privée (`private`) à l'IA.

## D57 — 2.0, itération 2 : lire une KB par révision (10 octobre 2026)

**Problème.** Chaque requête relisait et réanalysait toutes les notes : à 4 715 notes, 3,4 s pour charger, 4 s pour une recherche et 13 s pour les six requêtes de l'accueil (audit du 9 octobre, remesuré le 10 sur la 2.0 en cours). Une note était aussi analysée trois fois au chargement (titres, ancres, liens), et le contrôle des liens l'analysait encore.

**Décisions.**

- **Un instantané par KB, invalidé fichier par fichier** (`src/kb/bundle.ts`, F2.0-22).
  - Pour chaque fichier, OKB garde un tampon (inode, taille, dates de modification et de changement) et la note analysée.
  - Une nouvelle lecture liste les fichiers, lit leur tampon et ne relit que ceux qui ont changé. Si rien n'a changé, c'est le même objet `Bundle` qui revient, et les index et vues qui en dépendent restent valables.
  - Un fichier changé moins de 2 s avant d'être vu est relu à chaque fois jusqu'à ce qu'il se pose. Certains systèmes de fichiers ont des dates grossières, et deux écritures rapides pourraient avoir le même tampon. Une note relue au texte identique garde son analyse.
  - Les requêtes qui arrivent ensemble partagent la lecture de chaque note.
  - L'application d'une proposition relit tous les fichiers (`fresh`), en réutilisant l'analyse des textes inchangés.
  - Au plus huit KB sont gardées en mémoire.
- **Une seule analyse par texte** (`bodyFacts` dans `src/markdown/ast.ts`). Les liens, les ancres et les titres de premier niveau viennent d'une seule lecture du Markdown, gardée par texte et partagée par le chargement, le contrôle des liens, le graphe, la recherche, les scores et la maintenance. Les valeurs partagées sont gelées.
- **Le contrôle des liens garde ce qu'il a lu d'une note** (`src/links/check.ts`). Ses liens, ses ancres et la ligne où commence son corps sont gardés par texte. Les problèmes, eux, sont recalculés à chaque fois : une cible supprimée ou un titre retiré se voient même si la note qui pointe n'a pas changé.
- **L'index de recherche suit les notes qui changent** (`src/find/find.ts`). Les notes changées, ajoutées ou supprimées sont retirées puis remises dans l'index. Au-delà de 30 % de notes changées, ou si le plan du cerveau change, l'index est reconstruit. Un test vérifie qu'un index mis à jour répond exactement comme un index neuf.
- **Une mesure reproductible** (`npm run bench:speed`, `scripts/perf.mjs`) : des cerveaux fictifs de 415, 1 215 et 4 715 notes, sans IA. Elle mesure le chargement, la première recherche, la recherche répétée (médiane et p95), l'accueil et la recherche juste après une modification.

**Résultats, à 4 715 notes (macOS, Node 24, cerveau fictif).**

| Mesure | Avant | Après |
|---|---:|---:|
| Premier chargement | 3,4 s | 1,6 s |
| Chargement suivant | 3,4 s | 0,09 s |
| Première recherche | 9,6 s | 1,0 s |
| Recherche répétée, p95 | 4,0 s | 0,08 s |
| Accueil, six requêtes | 13,0 s | 0,44 s |
| Recherche juste après une modification | 4,0 s | 0,26 s |

La cible de la 2.0, une recherche répétée sous 200 ms au p95 à 5 000 notes, est atteinte sur ce cerveau fictif. Elle reste à confirmer sur un vrai cerveau.

**Conséquences.**
- `loadBundle` peut être appelé autant de fois qu'on veut : une KB inchangée coûte une liste de fichiers et leurs tampons (environ 50 ms à 4 715 notes).
- Une vue dérivée d'un `Bundle` peut se garder tant que l'objet est le même.
- Ce qui vient de `extractLinks`, `headingSlugs` et `bodyFacts` est partagé : on ne le modifie pas.

**Réexamen.**
- Revoir quand l'état opérationnel passera dans SQLite (F2.0-18).
- Revoir si une KB dépasse 20 000 notes : les mémoires par texte sont plafonnées à 20 000 entrées.
- F2.0-21 est découpée. La vitesse et le coût sont mesurés ici. « Ce que j'ai fait mardi » et le temps d'entretien par jour viendront avec le journal par projet et l'écran du soir (itérations 5 et 7), et seront relevés à l'itération 8.

## D58 — 2.0, itération 3 : un seul moteur, et les modules qui s'éteignent pour de bon (10 octobre 2026)

**Problème.** Une même action était écrite plusieurs fois, et les versions divergeaient. La recherche de la CLI ne comptait pas les étoiles, celle du web montrait les notes 🔒 quel que soit le demandeur, et les deux n'avaient ni la même limite ni la même façon d'enregistrer une recherche. Les assistants branchés par MCP n'avaient aucun accès propre. Enfin, éteindre le module développeur cachait ses commandes, mais rien n'empêchait le cœur de dépendre de son code.

**Décisions.**

- **Une opération s'écrit une fois** (`src/engine/`, F2.0-17). Elle déclare :
  - son identifiant (`notes.find`) ;
  - son module ;
  - son effet (`read`, `state` ou `propose`) ;
  - son entrée, un schéma zod qui donne aussi le schéma JSON pour MCP ;
  - sa fonction.
- **`invoke`** refuse une opération dont le module est éteint (`moduleOff`) et valide l'entrée (`invalidInput`, avec le champ en cause) avant de lancer quoi que ce soit.
- **Le contexte dit qui demande** : `person` ou `agent`. Claude par la CLI (`invokedBy`) et tout appel MCP sont des agents. Un agent ne voit aucune note 🔒, ni en recherche ni en lecture (`secretNoteForAgent`).
- **Pas d'approbation dans le moteur.** Approuver, appliquer, annuler et décider d'une carte ne sont pas des opérations. Un test vérifie qu'aucun identifiant ne ressemble à ces gestes.
- **Trois façons d'appeler.**
  - Le web garde ses adresses, et l'app ne change pas.
  - La CLI garde son affichage.
  - `okb mcp` est un serveur MCP en stdio, écrit sans dépendance : `initialize`, `ping`, `tools/list` et `tools/call`, avec les versions 2024-11-05 à 2025-11-25 du protocole. Les noms d'outils remplacent le point par `_`. Les annotations disent si un outil ne fait que lire.
- **MCP n'est pas inscrit d'office** dans le plugin. On l'ajoute avec `claude mcp add okb -- okb mcp`, et chaque assistant sera essayé avant d'être annoncé (vision, § assistants).
- **Six premières opérations** :
  - `notes.find` (même règles partout : étoiles, filtrage 🔒 des agents, limite de 10 par défaut, enregistrement seulement d'une recherche finie) ;
  - `notes.read` ;
  - `kb.status` ;
  - `suggestions.list` ;
  - `suggestions.add` (la raison reste facultative, pour les skills qui ne la donnent pas encore) ;
  - `repos.list`, du module développeur.

  Les autres actions passeront dans le moteur avec les écrans qu'elles servent.
- **Les scores mis en cache** quittent le serveur web pour `src/scores/cached.ts`, afin que le moteur s'en serve.
- **Le contrat des modules** (F2.0-25). Chaque opération appartient à un module ; un module éteint disparaît de MCP et refuse ses opérations. Un test de frontière interdit au cœur d'importer `repo/`, `work/`, `arch/`, `dev/` ou `knowledge/`, à part dans les adaptateurs (CLI, web) et le registre. Les 18 liens existants, dans onze fichiers, sont listés : la liste ne peut que diminuer.

**Conséquences.**
- Une action nouvelle s'écrit comme opération, puis la CLI et le web l'appellent.
- Un test compare la recherche par le web, la CLI de la personne, la CLI de Claude et MCP. L'ancienne CLI l'aurait fait échouer.
- La recherche de la CLI tient compte des étoiles, comme celle du web : l'ordre des résultats peut changer légèrement.

**Réexamen.**
- Les liens du cœur vers les tickets, quand le Projet entrera dans le cœur (itération 5).
- L'inscription de `okb mcp` dans le plugin, après essai sur Claude Code, Codex, Copilot et Cursor.
- Les notes `private` (et pas seulement `secret`) pour les agents : aujourd'hui, elles leur restent visibles, comme avant.

## D59 — 2.0, itération 4 : le grand ménage, cinq écrans et des mots simples (11 octobre 2026)

**Problème.** La 1.5 avait treize destinations dans la barre de gauche, des mots internes à l'écran (« KB », « proposition »), une ancienne interface encore servie sur `/classic`, et rien sur une note ne disait d'où elle venait ni si elle tenait encore.

**Ce que le propriétaire a décidé.** Le 11 octobre, après avoir vu des maquettes dans trois styles (l'actuel et deux nouveaux), il a écarté les nouveaux styles : l'interface garde le thème Atelier de la 1.5, sans changement d'identité. Les cinq écrans viennent de la vision validée le 10 octobre.

**Décisions.**

- **Cinq écrans** (F2.0-01) : Aujourd'hui, Projets, Mémoire, Assistant, Progresser.
  - Les treize destinations y sont rangées (`web-app/src/app/nav.ts`, `screenOf`). Les noms des pages dans le code ne changent pas, pour ne casser aucune adresse.
  - Un écran qui a plusieurs pages les montre en onglets sous la barre du haut : Notes et Graphe ; Demander et Dans ton terminal ; Projets, Repos et Architecture avec le module développeur.
  - « À valider » quitte la barre de gauche pour la barre du haut, avec son nombre, sur tous les écrans.
  - « Garde ça » (⌘J) est sur tous les écrans : une ligne écrite par la personne part tout de suite dans ses captures, sans validation.
  - Le reste va dans le menu « Plus » (Outils, Santé, Modules, Aide), et les Réglages restent à un clic.
  - Nouvelles adresses : `#/projects`, `#/project/<id>`, `#/memory`, `#/assistant`, `#/progress`.
- **Les mots simples** (F2.0-02). Aucun message que l'app affiche ne dit « KB », « proposition » ou « bundle » : on dit « cerveau », « tes notes », « changement prêt à relire », « note à écrire ». Un test lit les clés que l'app nomme et refuse ces mots, en français et en anglais ; un autre vérifie que chaque clé existe dans les deux langues. Le renommage en « espaces » viendra avec l'itération 7.
- **La fin de l'ancienne interface** (F2.0-26). `web/index.html`, `web/js/` et `web/app.css` sont supprimés ; `/classic` redirige vers l'application ; la route `/vendor/d3-force.js`, que seule l'ancienne interface utilisait, disparaît.
- **Sources et validité** (F2.0-27, `src/kb/provenance.ts`). Pour chaque note : ses sources (une par ressource, avec le nombre de phrases qui la citent), qui l'a écrite (la personne ou l'IA, d'après `generated.by`), quand elle a été approuvée (le dernier reçu complet et non annulé qui l'a écrite) et jusqu'à quand elle tient (`stale_after`).
  - Savoir si une source locale a changé se demande d'un clic (`GET /api/note/freshness`) : la comparaison lit l'état privé et les fichiers, elle n'est donc pas faite à chaque ouverture. Rien n'est téléchargé ni deviné.
  - `notes.read` rend aussi ces informations aux assistants.
- **Les notes à ranger dans le graphe** (F2.0-19, `src/brain/tidy.ts`). Le graphe reste dans Mémoire. Il montre les notes hors des tiroirs et celles que rien ne relie aux autres, leur fil d'Ariane mis à part ; un clic les allume.
- **L'écran Projets** s'appuie sur l'objet Projet et la base d'état SQLite, posés ici et décrits avec l'itération 5 (D60).
- **Node 22.13** devient le minimum : c'est la première version dont le SQLite intégré marche sans option.

**Conséquences.**
- Une page nouvelle se range dans un écran (`screenOf`) ou dans le menu Plus ; son libellé passe le test des mots.
- La documentation et les captures d'écran des guides parlent de cinq écrans ; les captures seront refaites avant la sortie de la 2.0.

**Réexamen.**
- Le choix de l'espace à la place du choix du cerveau, à l'itération 7.
- La place de « Dans ton terminal » quand l'Assistant deviendra une conversation (2.3).

## D60 — 2.0, itération 5 : le projet au centre, les actions, le journal, l'état dans SQLite (11 octobre 2026)

**Problème.** OKB rangeait des notes, mais ne tenait pas le fil du travail : pas d'objet pour « ce sur quoi je travaille », pas d'actions ni d'attentes, un journal reconstitué après coup, rien pour dire où on en était en quittant un sujet. Ce qui se coche vivait dans des fichiers JSON, et le cœur importait le code des tickets.

**Décisions.**

- **L'état opérationnel dans SQLite** (F2.0-18, `src/state/db.ts`).
  - Une base par profil, `okb.db`, dans le dossier d'état : hors des notes et hors de tout dossier synchronisé. Le savoir reste en Markdown.
  - C'est le SQLite de Node (`node:sqlite`) : aucune dépendance à installer ni à compiler. D'où Node 22.13 au minimum. L'avertissement « experimental » de Node est filtré à l'ouverture.
  - Mode WAL et attente de 5 s sur verrou : le terminal et l'app écrivent en même temps sans rien perdre. Les migrations sont numérotées (`user_version`) et ne se réécrivent jamais.
  - Y vont : les projets, les actions, le journal. Les révisions, la progression et les tickets restent dans leurs fichiers pour l'instant ; ils y passeront avec la migration des vraies KB (itération 8).
- **Le Projet** (F2.0-03, `src/projects/`). Un sujet que la personne crée, ou ce qu'un module apporte. Il dit où il en est en une phrase, sa prochaine étape, et garde « Où j'en étais ».
- **Ce qu'un module apporte au cœur** (F2.0-25, `src/projects/sources.ts`). Un module déclare une source : ses projets (`seeds`), ce qui s'y est passé (`events`), le travail qu'il suit (`work`) et les noms propres au lieu de travail (`privateNames`). `src/modules/wire.ts` est le seul fichier qui connaît tous les modules ; il est chargé au premier besoin. Le module développeur y déclare ses tickets et ses repos.
  - Le cœur n'importe plus les tickets : « Maintenant », le journal de la semaine, les cartes de suggestion et la carrière passent par ces sources. La dette passe de 18 à 12 liens ; ce qui reste concerne la découverte des repos à l'installation et le rangement produit › repo.
  - Éteindre le module cache ses projets, leurs actions et leurs lignes de journal, sans rien supprimer.
- **Les actions et les attentes** (F2.0-06). Quatre sortes : à faire, attendu de quelqu'un, demandé, question ouverte ; avec un jour quand il y en a un. Cocher une action écrit une ligne « fait » dans le journal de son projet. Ce qu'un agent ajoute est marqué `ai`.
- **Repérer une action sans IA** (`src/projects/detect.ts`). Des déclencheurs (« il faut », « ne pas oublier de », « j'attends », un infinitif en tête de ligne) et des dates dites simplement (demain, lundi, le 15 mai, 3/11), en français et en anglais. OKB propose, la personne confirme. Un simple fait n'est jamais pris pour une action.
- **Le journal par jour et par projet** (F2.0-05). Les lignes de la personne et celles qu'OKB note pour elle sont dans la base ; un module y ajoute ce qu'il sait de ses projets (les décisions et les commits d'un ticket).
- **Le jour est celui de la personne** (`src/util/day.ts`) : un jour se compte dans son fuseau horaire. Une ligne écrite à une heure du matin à Paris appartient à ce jour-là.
- **« Où j'en étais »** (F2.0-07, `src/projects/leave.ts`). En quittant un projet, OKB prépare quatre lignes (fait, essayé, en attente, par où reprendre) à partir du journal et des actions depuis la dernière fois, sans IA. Une correction garde le reste et marque la reprise comme corrigée.
- **Aujourd'hui répond à six questions** (F2.0-04, `src/projects/today.ts`) : reprendre, à faire, en attente, ce qui s'est passé, ce qui est entré dans la mémoire cette semaine, à revoir et à comprendre. « À comprendre » est, en 2.0, une fiche concept que les notes utilisent et que la personne n'a jamais ouverte ; la dette de compréhension complète vient en 2.2.
- **Garde ça** écrit dans le journal du projet choisi, sinon dans les captures, et propose l'action qu'il repère.
- **Partout pareil** : dix opérations de plus dans le moteur (`projects.*`, `actions.*`, `journal.*`, `today.view`), servies à l'app, à `okb project`, `okb action`, `okb today`, `okb journal add` et à MCP.

**Conséquences.**
- Un assistant peut tenir les projets, les actions et le journal : c'est l'état du travail, pas du savoir. Une note passe toujours par une carte et le oui de la personne.
- Une sauvegarde doit maintenant emporter `okb.db` (itération 8).

**Réexamen.**
- Faire passer les tickets eux-mêmes dans la base, avec la migration (itération 8).
- Le prochain rendez-vous dans Aujourd'hui : il demande un agenda, pas encore décidé.
- Les questions en attente de « Maintenant » (`okb now wait`) font doublon avec les attentes : à fusionner à la migration.

## D61 — 2.0, itération 6 : garder un fichier tel quel, écrire à la bonne longueur, repérer sans interrompre (11 octobre 2026)

**Problème.** OKB ne savait garder que des notes : un PDF ou une photo devait être recopié ou restait dehors. Le style d'écriture se réglait avec trois presets et huit curseurs, mais une fiche concept et un guide avaient la même longueur. Et Claude proposait une note au fil de la conversation, pour deux moments seulement, au risque d'interrompre.

**Décisions.**

- **Les documents** (F2.0-10, `src/documents/`).
  - Un fichier est copié tel quel dans `_Documents/<année>/`, à côté des notes. Il n'est jamais modifié ni écrasé (écriture `wx`, noms `-2`, `-3`). Le même contenu (sha256) n'est gardé qu'une fois.
  - Son texte est lu par les lecteurs de sources déjà là, et indexé dans la base d'état (SQLite FTS5, sans accents). La liste et l'index sont de l'état ; le fichier, lui, est du savoir et part avec les notes.
  - Un document n'est pas une note : le chargeur de KB ignore `_Documents/` (pas d'orphelin, pas de score, pas de graphe).
  - **C'est la seule écriture directe dans le dossier des notes.** La personne dépose son propre fichier : il n'y a rien à relire, donc pas de proposition. Garder, renommer, relier et mettre un cadenas sont réservés à la personne (`agents: false` : l'opération n'est pas listée par MCP et refuse un agent). Un assistant peut chercher, et ne voit jamais un document 🔒.
  - Ouvrir un fichier le passe au système comme un seul argument, sans interpréteur de commandes (`openFile`) : un nom de fichier est une donnée. `OKB_NO_OPEN=1` ne lance rien ; l'app dit alors où est le fichier.
- **Les réglages d'écriture** (F2.0-11, `src/style/simple.ts`).
  - Deux choix simples, posés sur l'existant : le **style** (technique, normal, simplifié) nomme les trois presets (`expert`, `standard`, `pedagogique`) ; la **longueur** (courte, normale, détaillée) nomme le curseur `detail`. Pas de troisième système.
  - **Un défaut par type de note** : un concept et toute fiche « une minute » sont courts, un guide est détaillé, une décision est courte et garde son pourquoi, un compte rendu est normal. Les autres types suivent le réglage général.
  - Ordre : preset → réglages généraux → type de note (défaut du produit, puis choix de la personne dans `writing.byType`) → demande ponctuelle. Ce qui est dit pour un type est plus précis que le réglage général : il l'emporte.
  - Le style propre à un type change le point de départ et garde les curseurs généraux de la personne (ses schémas, ses exemples). Un preset demandé pour une seule fois reste un nouveau départ, comme avant.
  - `okb style --type <type>` donne le brief du type ; `okb suggest accept` renvoie cette commande (`styleCommand`).
- **Les moments repérés** (F2.0-09, `src/suggest/moments.ts`, `src/suggest/session.ts`).
  - Six moments, repérés sans IA à la fin d'une réponse : une longue explication demandée, la même question deux fois, un bug résolu après plusieurs essais, une décision, une commande découverte, une erreur et sa cause.
  - Un moment que les mots nomment (« c'est quoi OData ? ») devient une carte tout de suite, sans rien montrer. Les autres attendent : c'est l'assistant, déjà dans la conversation, qui les nomme à la fin. OKB ne fabrique pas un titre.
  - **Par défaut, rien n'est proposé en cours de route** (`suggest.mode: session`, à la place de `live`). Quand la personne clôt la session, une seule question regroupe **trois choses au plus**, les cartes d'abord.
  - **« Pas maintenant » est retenu** : les cartes passent à « plus tard » avec une date (sept jours) et attendent dans l'application ; la session ne propose plus rien.
  - La session est celle que donne le hook (`session_id`). Son identifiant entre dans une commande : seuls lettres, chiffres, `_` et `-` sont acceptés.

**Conséquences.**
- Le registre du moteur compte trois opérations de plus (`documents.add`, `documents.list`, `documents.update`), et `notes.find` renvoie aussi les documents trouvés.
- Une sauvegarde doit emporter `_Documents/` avec les notes, et `okb.db` (itération 8).
- Qui tenait à la proposition immédiate choisit `suggest.mode: live` ; elle reste limitée à trois par session.

**Réexamen.**
- Relier un document à une note depuis l'application (le champ existe, l'écran non).
- Lire le texte d'une image ou d'un enregistrement : pas sans IA, donc pas ici.
- Le plafond de trois par session et les sept jours, après un mois d'usage réel.

## D62 — 2.0, itération 7 : deux espaces étanches, et un oui proportionné (11 octobre 2026)

**Problème.** Un cerveau de travail et un cerveau personnel étaient deux « KB » sans rien qui dise lequel t'appartient. Une leçon apprise au travail ne pouvait suivre la personne qu'en la recopiant, noms de clients compris. Et chaque chose préparée par un assistant demandait sa propre visite : la relecture du soir prenait plus de temps que la journée n'en avait fait gagner.

**Décisions.**

- **Deux espaces** (F2.0-12, `src/spaces/space.ts`). Chaque cerveau est dans **Mon bagage** (`baggage`) ou dans **Travail** (`work`), par le réglage `kb.space`. Sans réglage : un cerveau « carrière » est le bagage, tout autre est du travail. On se trompe du côté prudent : traiter un cerveau personnel comme du travail ne fait rien fuir, l'inverse si.
- **Étanches par construction, et par trois refus.** Une recherche, le graphe et la journée ne lisent qu'un cerveau. S'y ajoutent : un partage (pack) est refusé depuis le bagage ; un pack reçu n'y entre pas ; un assistant ne peut pas emporter une note 🔒.
- **« Garder dans mon bagage »** (`src/spaces/baggage.ts`) est le seul pont, du travail vers le bagage.
  - OKB prépare sans IA une première version : les noms que le cerveau connaît (produits, clients, dépôts), les références de tickets, les adresses, les liens internes et les montants laissent place à des mots neutres ; un lien public reste. Ce qui a été retiré est listé.
  - La personne relit ou réécrit. Le texte final est revérifié : s'il nomme encore le travail, il est refusé avec ce qui reste. C'est la détection de la copie portable de la carrière (1.5), sortie dans `src/spaces/details.ts` et partagée ; un nom contenu dans un autre (un produit dans son dépôt) ne compte qu'une fois, et les références publiques (UTF-8, ISO-8601, une CVE) ne sont plus prises pour des tickets.
  - Le résultat est une **proposition dans le bagage**, que la personne approuve là-bas. La note ne garde ni chemin, ni identifiant, ni source du travail : seulement `x_okb.origin` (« vient du travail », et le jour).
  - OKB ne réécrit pas lui-même en leçon générale : c'est le rôle de la personne, ou de Claude dans la conversation (skill carrière), toujours sous la même vérification.
- **Le oui proportionné** (F2.0-13). Ce que la personne écrit passe directement : une capture, une ligne de journal, une action, un document (itérations 5 et 6). Ce qu'un assistant rédige, remplace ou propose attend son oui.
- **L'écran du soir** (`src/evening/evening.ts`), vue par défaut de « À valider ». Les notes proposées (avec leur coût) et les changements prêts sont listés, tous cochés ; la personne décoche et dit oui au reste.
  - **Une seule confirmation pour le lot** : la fenêtre du système (ou le terminal) nomme le nombre de changements et de fichiers. Un refus ne change rien. Sans moyen de demander, aucun changement n'est approuvé ; les cartes, elles, sont acceptées, puisqu'un clic de la personne suffit déjà pour une carte.
  - Chaque changement est approuvé et appliqué séparément : un changement périmé n'arrête pas les autres, et la réponse dit lequel.
  - Le budget du jour vaut pour le lot : une carte qui le dépasserait reste en attente, et l'écran le dit.
  - Un changement qu'une règle refuse n'entre pas dans le lot : il est montré à part.
  - Dire oui n'est pas une opération du moteur : aucun assistant ne peut le faire. Lire la liste (`evening.view`) en est une.

**Conséquences.**
- Le moteur compte trois opérations de plus : `baggage.draft`, `baggage.keep`, `evening.view`.
- « À valider » s'ouvre sur tout ce qui attend ; les changements seuls ont leur adresse (`#/changes`).
- Une carte acceptée n'est pas encore écrite : sans assistant dans l'application (2.3), c'est Claude qui l'écrit dans le terminal, quand la personne le demande. L'écran le dit.

**Réexamen.**
- Demander l'espace à la création d'un cerveau et à la migration des vraies KB (itération 8).
- L'espace Partagé, avec les tiroirs (2.1).
- « En arrivant sur un nouveau sujet, ce que ton bagage contient d'utile » : lire le bagage depuis le travail, dans ce sens-là seulement (3.1).
- Écrire les notes acceptées depuis l'application, quand l'assistant y sera (2.3).

## D63 — 2.0, itération 8 : durer — une sauvegarde qui ramène tout, un passage à la 2.0 qu'on peut regarder, des indicateurs séparés (11 octobre 2026)

**Problème.** La sauvegarde copiait les fichiers d'une base en cours d'écriture et ne restaurait que les notes : ni projets, ni actions, ni journal, ni réglages. Personne n'avait jamais essayé une restauration. Passer un cerveau de la 1.5 à la 2.0 se faisait sans le dire. Un seul chiffre de « santé » cachait ce qui manquait. Et rien ne vérifiait l'application comme une personne s'en sert, ni ce qui arrive quand ça coupe.

**Décisions.**

- **Une sauvegarde qui ramène tout** (F2.0-14, `src/brain/backup.ts`).
  - Un instantané contient les notes et les documents, l'état, et les réglages du cerveau. La base d'état est copiée entière et cohérente (`VACUUM INTO`), jamais comme les trois fichiers d'une base en cours d'écriture. La clé d'approbation n'y est toujours pas.
  - L'instantané note ce qu'il contient (notes, documents, projets, actions, lignes de journal, révisions).
  - `restore --as <nom>` ramène un cerveau entier comme **nouveau** cerveau. Une restauration ne remplace jamais un cerveau qui existe.
  - **L'essai de restauration** (`okb backup drill`) restaure le dernier instantané dans un dossier temporaire, vérifie chaque empreinte, ouvre la base, la compte et compare avec ce que l'instantané disait. Rien du cerveau n'est touché. Un essai de plus de cinq semaines est signalé ; un essai en échec est une erreur. Un test fait cet essai à chaque version.
  - **Visible** : Aujourd'hui dit « Sauvegardé » ou prévient ; la page Santé dit où, quand, et quand la restauration a été essayée. L'application prend la sauvegarde du jour toute seule (trente secondes après son ouverture, puis chaque heure), comme le faisait déjà le début d'une session Claude.
- **Les révisions dans la base** (F2.0-18, `src/learn/learn.ts`). L'état de chaque carte et le journal des réponses vont dans `okb.db`. Une réponse écrit la carte et sa ligne ensemble, ou rien. Un cerveau de la 1.5 est lu une fois depuis ses deux fichiers, dans une transaction ; **les fichiers restent tels quels**, donc la 1.5 ouvre encore son état.
  - La progression n'a rien à déménager : elle est calculée à partir des journaux.
  - Les tickets restent dans leurs fichiers : c'est l'état du module développeur, il passera dans la base avec le quotidien du dev (2.4).
- **Passer à la 2.0** (F2.0-16, `src/migrate/v2.ts`, `okb migrate 2.0`).
  - Essai à blanc par défaut : il lit, et ne crée rien, pas même la base.
  - `--apply` : la sauvegarde d'abord, puis les révisions, puis la vérification (tout est arrivé), puis la marque. Chaque étape se rejoue : une migration coupée se termine en relançant la commande.
  - `--rollback` : les fichiers de la 1.5 reçoivent tout ce qui a été étudié depuis, et la base oublie les révisions. Les notes ne sont jamais touchées, dans aucun sens.
  - Validé sur des copies de cerveaux réels (essai à blanc, application, essai de restauration, retour) : les empreintes des originaux sont identiques avant et après.
- **Des indicateurs honnêtes** (F2.0-24, `src/indicators/indicators.ts`). Quatre, séparés : la couverture (les termes utilisés ont-ils leur fiche), la fraîcheur (une source a-t-elle changé, une date est-elle passée), la qualité (comment les notes sont écrites), la compréhension (ce que la personne a étudié et sait).
  - Chacun dit de quoi il est fait : tant sur tant.
  - **Pas de chiffre quand il n'y a rien à mesurer** : jamais un 100 par défaut.
  - Chaque manque mène à un geste : une note à ouvrir, un écran, une commande.
- **Les mesures** (F2.0-21). Un jour dit en mots (« mardi », « hier », « le 14 février ») ouvre ce jour du journal : `okb journal mardi`, ⌘K, `#/day/<date>`. `okb metrics` mesure le temps pour retrouver un jour, le temps d'entretien par jour (estimé à partir des gestes de validation : des gestes à moins de cinq minutes d'écart font une séance) et les tokens par jour.
- **Les parcours et les pannes** (F2.0-20).
  - Neuf parcours dans un vrai navigateur (Playwright, `npm run test:journeys`) : les cinq écrans, À valider, les espaces, le téléphone, « ce que j'ai fait ». Une erreur de page fait échouer un parcours. Ils ne font pas partie de `npm run check`, qui doit tourner partout sans navigateur.
  - Les pannes sont dans la suite ordinaire : quatre fenêtres qui écrivent en même temps, une coupure au milieu d'une écriture, le même port lancé deux fois, un fichier arrivé avant la coupure, une migration coupée.

**Conséquences.**
- Le moteur compte trois opérations de plus : `backup.status`, `indicators.view`, `day.view`.
- Un fichier resté dans `_Documents/` après une coupure est repris tel quel au lieu d'être copié une seconde fois.
- `playwright-core` est une dépendance de développement ; les parcours utilisent le Chromium de Playwright s'il est installé, sinon Chrome ou Edge.

**Réexamen.**
- La page d'une note porte deux titres de niveau 1 (la barre du haut et la note) : à corriger avec l'accessibilité de la 3.0.
- Faire entrer les parcours dans la vérification d'avant version, quand un navigateur est garanti sur la machine qui publie.
- La porte de la 2.0 demande un mois d'usage réel : les mesures sont là pour le dire, pas pour le remplacer.

## D64 — 2.1 : deux tiroirs, une copie de travail séparée et un envoi explicite (11 octobre 2026)

Le partage réutilise Git dans un dossier commun distinct des KB personnelles. Chaque auteur écrit dans son tiroir. L'aperçu contient les octets prévus et leur empreinte ; un changement depuis l'aperçu impose de le revoir. 🔒, bagage et carrière sont exclus. Les manifestes, chemins et liens symboliques sont contrôlés avant lecture et écriture.

Préparer reste local ; envoyer et recevoir sont des gestes explicites. L'envoi ne stage que les fichiers gérés, conserve les autres changements et refuse les commits locaux déjà en attente : pousser la branche les publierait aussi. Aucun force-push ni stash automatique. Une réception avance seulement sans divergence. Une panne de push demande une nouvelle relecture, sans répétition invisible.

Recherche, lecture d'assistant, carte et glossaire conservent auteur et origine. Garder une note d'un collègue prépare une proposition ; les packs existants restent utilisables. Un partage indisponible ne rend pas la recherche personnelle inutilisable. Le contrôle d'accès au dépôt et son historique restent ceux de Git : supprimer une note n'efface pas ses anciens commits.

Le travail commencé par Claude a été poursuivi. La validation technique sur dépôts fictifs ne prouve ni l'autorisation d'entreprise ni le mois de réutilisation demandé par la porte 2.1. Voir [la spec](specs/2026-10-11-2.1-partage.md).

## D65 — 2.2 : comprendre par les lectures et les gestes, sans certificat de maîtrise (11 octobre 2026)

Les lectures réutilisent le moteur et la porte IA. Elles sont calculées à la demande, gardées dans la base opérationnelle et liées aux empreintes du contenu et du contexte. Garder prépare une révision normale. Les cinq niveaux décrivent des consultations observées ou des gestes déclarés ; un quiz ne les augmente jamais automatiquement.

Les dettes regroupent points flous et rencontres répétées. La carte reprend les liens existants. Réunions et parcours s'appuient sur notes, actions, objectifs et cartes disponibles, en conservant FSRS. La progression privée est facultative et désactivée par défaut, sans classement. La migration 6 ajoute deux tables ; le savoir demeure en Markdown. Aucun framework d'agents supplémentaire.

Les tests couvrent invalidation, confidentialité, citations, proposition sans écriture, gestes idempotents et calendrier. Une citation exacte ne vérifie pas la vérité ni la qualité pédagogique du modèle. La porte d'usage reste à mesurer. Voir [la spec](specs/2026-10-11-2.2-comprendre.md).

## D66 — 2.3 : un agent local choisi, un transport borné et des réponses traçables (11 octobre 2026)

L'application appelle l'agent installé, avec sa connexion et sa configuration autorisées. Pas de clé extraite, pas de fournisseur ajouté, pas de fallback API après le choix explicite d'un agent local. La disponibilité de l'exécutable est distincte de la connexion et du quota. Le processus est lancé sans shell, dans un dossier vide, avec durée et volume bornés ; annuler ou fermer termine les appels contrôlés. Les réglages et hooks propres à l'agent restent dans son périmètre de confiance.

Chaque conversation appartient à l'espace actif. Le modèle lit via MCP ; 🔒 et secrets détectés sont refusés dans le texte et les résultats structurés. Le contenu et le cadenas sont revérifiés avant envoi et conservation. Les réponses distinguent citation de note, explication générale et inconnu. Les citations exigent une source connue et un extrait exact, sans prétendre certifier le sens. Les gestes proposés attendent la personne ; aucune approbation n'est exposée à l'agent.

Les conversations, actions et compteurs vivent dans SQLite (migration 5). Une consommation inconnue reste inconnue ; estimation et consommation déclarée ne se confondent pas. Échecs et annulations comptent aussi. L'estimation avant appel n'est pas un plafond du contexte ajouté par un CLI.

Claude Code a son adaptateur et ses tests simulés ; l'essai réel de génération a échoué dans cet environnement, sans cause suffisamment établie. Codex est expérimental, désactivé par défaut et limité à la version réellement essayée. Un test réel a réussi `notes_find` puis `notes_read` sur un cerveau fictif. Il ne valide pas toutes les conversations, les coûts ni les conditions commerciales. L'invocation remplace seulement sa carte MCP, sans modifier la configuration ni les accès de la personne. Voir [la spec et les mesures](specs/2026-10-11-2.3-assistant.md).

## D67 — 2.4 : tickets opérationnels et observations indépendantes (11 octobre 2026)

Les tickets, détails, états, critères, essais et réutilisations vivent dans SQLite, hors des notes et du partage. La migration 7 importe une fois les JSON privés validés ; les fichiers et textes restent intacts comme archives. Les commandes de suivi existantes restent compatibles. Fusionner des espaces transfère cet état dans une transaction, remappe les références de notes et refuse une collision différente ; la source reste intacte et une relance ne duplique rien.

Travail, PR/revue, vérifications, attente et livraison par environnement restent indépendants. L'absence d'information vaut inconnu ; fusionner une PR ne prouve jamais une livraison. Le brief conserve objectif, dernière action, essais échoués avec conditions et prochaine étape. La clôture contrôle les critères que la personne a rendus obligatoires ; les repères initiaux restent facultatifs pour les tickets anciens.

Les opérations résident dans `src/work/operations.ts`, raccordées au registre commun. Aujourd'hui reçoit les notes à revérifier par un hook `ProjectSource` ; aucun nouvel import du module dev dans le cœur. Un code cité modifié signale une fraîcheur à contrôler, pas une note automatiquement fausse.

GitHub se lit explicitement via la session `gh`, après opt-in serveur/dépôts et politique ; ni login, ni jeton extrait, ni écriture distante. Jira reste un instantané déclaré par la personne, avec provenance et date. Le lecteur externe, la reprise en moins d'une minute et le mois sans oubli demandent leurs essais propres. Voir [la spec](specs/2026-10-11-2.4-quotidien-dev.md).

## D68 — 3.0 : emballer le même produit, sans multiplier les moteurs (11 octobre 2026)

Electron embarque le runtime et ouvre la même application React sur le même serveur loopback et moteur. Port attribué automatiquement, instance desktop unique, Atelier et cinq destinations conservés. L'accueil crée un espace et un premier projet ; l'activité adapte les exemples, sans inventer un module métier. Le premier résultat est possible sans IA. Ajouter un espace non-dev ne retire pas le module dev d'un autre espace.

Les sauvegardes et leurs lecteurs partagent un verrou par profil, y compris pendant un export. Un nouvel instantané est vérifié avant publication ; le précédent reste récupérable si le processus s'interrompt. Un dossier de notes illisible ou un fichier recensé qui ne peut être lu fait échouer le snapshot : aucune réussite avec des données omises. Les destinations physiquement sous les notes ou l'état sont refusées. Le serveur suit aussi un espace créé après son ouverture et un changement d'espace actif. Quitter le desktop ou le serveur CLI arrête les entrées, annule les corps incomplets et les agents, puis attend les écritures et sauvegardes engagées avant fermeture de l'état.

Renderer sandboxé, Node désactivé, contexte isolé, navigation limitée à l'origine exacte, fenêtres et webviews refusées. Le preload expose seulement un sélecteur de dossier et quatre gestes de mise à jour, vérifiés depuis la frame principale. L'export emporte notes, documents, état SQLite cohérent, réglages et manifeste, sans clé d'approbation. Le dossier destination doit être neuf, séparé et physiquement hors du cerveau et de son état.

La distribution signée exige deux feeds HTTPS fixes et une identité d'éditeur. Le prototype laisse les mises à jour désactivées. Canaux runtime et build utilisent les mêmes manifestes explicites, `latest` ou `beta`. L'identité installée est contrôlée par codesign sur Mac, par Authenticode et les métadonnées d'éditeur sur Windows ; le téléchargement est aussi vérifié par l'updater. Aucun téléchargement automatique, installation seulement après le geste de la personne. La commande de release exige signature et parcours navigateur, sans publication implicite.

Le chargement du panneau Assistant est différé jusqu'à son ouverture. Un seul titre principal accessible reste présent ; les titres Markdown et leurs ancres sont conservés. Les tests de composants ne valent ni contrôle visuel ni conformité WCAG. Un prototype Mac non signé et le runtime embarqué peuvent être vérifiés localement ; Windows réel, certificats, notarisation, mise à jour et les deux semaines chez les proches restent à valider. Voir [la spec](specs/2026-10-11-3.0-desktop.md).

## D69 — Corriger la reprise depuis l’usage, sans nouveau moteur (13 octobre 2026)

La commande ticket réconcilie l’état opérationnel et les notes autorisées avant
création. La référence normalisée et le repo participent à l’identité ; une
ambiguïté requiert seulement le choix manquant. Les informations humaines sont
conservées, les conflits explicités et les écritures de savoir préparées en
propositions. Les appels identiques ne réoffrent pas un changement refusé.
Les dimensions travail, revue, CI et livraison restent indépendantes.

Les projets/tickets représentent le travail ; Repos porte son contexte
technique. Une présentation d’aperçu commune renvoie au détail spécialisé, avec
les anciens liens préservés. Atelier, les cinq destinations et Progresser
restent en place. L’Assistant se lance depuis un travail et sélectionne des
passages dans la note entière ; il conserve son contexte aux tours suivants.

Les hooks gardent leur contrat **Claude Code**. Leur runtime commun distingue
les exclusions volontaires, la résolution, les délais, les erreurs CLI et la
sortie invalide. Le diagnostic borné ne journalise pas les entrées ou secrets.
Un fichier absent ne permet pas de prouver qu’un hook est chargé ; un contexte
délivré ne permet pas de prouver que le modèle l’a utilisé.

L’architecture conserve les relations du modèle sous les regroupements et
permet d’explorer les voisins/preuves avec une liste complémentaire. Le scanner
garde une méthode HTTP dynamique inconnue et ne transforme pas une technologie
de données en instance certaine. Le rendu testé ne prouve pas l’exactitude du
scan sur un repo personnel.

La lecture d’un gros VTT distingue recherche ciblée et compte rendu complet.
Les snapshots et blocs/timecodes existants sont conservés. Un ledger hors KB
cache les résultats par fenêtre, affiche couverture déclarée et lacunes,
valide citations/appartenance et garde les faits remplacés avec leur correction.
La détection lexicale considère aussi des corrections éloignées ; elle ne
décide pas seule du sens. Le dossier final passe par la proposition existante.

La revue D41 devient proportionnée à la demande d’usage : pas de second modèle
pour répéter les contrôles déterministes ; revue éditoriale justifiée pour une
synthèse longue, inférence, contradiction, correction ou engagement incertain.
Consentement, proposition, approbation et application ne sont pas fusionnés.
Les refus et « pas maintenant » ne déclenchent pas de relance inchangée.

Le minimum Node reste 22.13.0 après vérification des API et des déclarations
des dépendances ; CLI, compilation et runtime embarqué sont documentés séparément.
Les mesures locales ne déclarent ni économie facturée, ni vérité garantie,
ni qualité d’usage ou marché acquis. Voir le
[bilan d’acceptation](VALIDATION-USAGE-2026-10-13.md).

## D70 — Un ticket, une seule fiche (19 octobre 2026)

Un ticket a une fiche unique, lue par l’accueil, la liste, le terminal,
l’assistant et le brief de session (F2.4-08). La prochaine étape n’est plus un
champ : c’est la première todo ouverte du ticket — épinglée, sinon la plus
importante, puis la plus ancienne (F2.4-13). Les colonnes 2.0 (objectif,
dernière action, prochaine étape) restent lisibles et ne sont plus écrites.

Chaque valeur garde son origine (personne, agent, Jira, ServiceNow, wiki,
GitHub, autre), sa date et son lien. Une valeur écrite par la personne n’est
jamais remplacée : une autre source devient un écart qu’elle arbitre (F2.4-09).
Une valeur vide, « inconnu » ou la référence seule est refusée ; rien n’est
inventé pour remplir. Depuis le terminal, la personne écrit en son nom quel que
soit `--origin` ; seul un agent conserve l’origine d’une source.

OKB ne contacte ni Jira, ni ServiceNow, ni un wiki. La personne demande à son
agent de compléter une fiche ; une seule demande ouverte par ticket ; l’agent la
voit au début de session, lit ce que ses outils permettent, écrit avec origine
et lien, et rend compte de ce qu’il n’a pas pu lire (F2.4-10).

Une note se lie à un ticket par ses métadonnées (`tickets:`), par la note
qu’OKB a écrite pour lui, par son rangement sous le ticket ou à la main. Une
simple mention n’est qu’une suggestion ; une suggestion écartée ne revient pas
(F2.4-11). La complétude mesure ce qu’on sait pour reprendre, jamais
l’avancement : dix rubriques de même poids, « non applicable » sorti du compte
(F2.4-12).

Les tickets 2.0 sont repris une fois, après une copie de la base. Une valeur
qui ne fait que répéter la référence ou le dernier commit reste non définie.
2.0 ne gardait pas trace d’une correction à la main : les valeurs reprises sont
attribuées à l’agent, et une valeur remplacée reste dans le journal du ticket.
Arrêter de suivre garde une copie 30 jours. Les changements de champ restent
dans l’historique du ticket, pas dans le journal du jour.


## D71 — Valider en un geste (22 octobre 2026)

Amende D25 (approbation par présence humaine) et la règle « aucune écriture
dans la KB sans le oui de la personne ».

Chaque KB a un réglage que seule la personne change :
`changes.agentWrites: proposal | review-later`, `proposal` par défaut (F2.0-52).
Avec `proposal`, rien ne change. Avec `review-later`, l’agent prépare toujours
une proposition ; `okb keep` (opération `notes.keep`) applique tout de suite ce
qui crée une note ou modifie une note encore « à relire », avec l’approbation
`policy:review-later`, et laisse en attente ce qui touche une note validée. Une
proposition mixte est séparée. Les gardes (chemins, secrets, confidentialité,
nombre de fichiers) ne changent pas (F2.0-54).

L’état de relecture vit dans l’état SQLite (`note_reviews`, migration 9), pas
dans les notes : aucune réécriture en masse. Une note existante est validée si un
reçu approuvé par un humain la contient ou si elle n’a pas de champ `generated` ;
sinon elle est à relire. Le déplacement suit l’`id` OKF (F2.0-53).

La personne trie au calme dans « À relire » : Oui, Non (cette seule note est
retirée, le reçu et la copie restent), Changer l’emplacement (liens réparés),
Faire relire, Oui à tout (F2.0-55). Ces gestes ne sont pas des opérations du
moteur : un agent ne peut ni valider, ni retirer, ni appliquer une modification
en attente, ni changer le réglage (refusé aussi par le hook `guard-approval`).

`okb serve` ouvre le navigateur avec un lien à usage unique (valable une
minute, un seul à la fois) que la page échange contre une clé de session. La
page la garde dans son onglet (`sessionStorage`, propre au port) et l’envoie en
en-tête ; jamais en cookie, qu’un navigateur enverrait à tous les ports de
127.0.0.1. Avec cette clé, les gestes, l’approbation et le réglage d’écriture se
font sans fenêtre système ni terminal ; sans elle, l’app retombe sur la
confirmation de D25 (F2.0-56). La clé n’est jamais écrite
sur disque ni affichée. Limite honnête : elle passe en argument de la commande
système qui ouvre le navigateur, et ne protège pas d’un logiciel qui pilote la
souris de la personne.

La part des notes validées est un indicateur de la santé de la KB : une ligne
discrète sur l’accueil, la barre d’état et le cinquième indicateur (F2.0-57).
`okb keep` ne valide jamais, quel que soit celui qui le lance ; il ne supprime
jamais une note ; il ne touche pas une note à relire que la personne a modifiée
depuis l’écriture de l’agent (empreinte différente). « Oui à tout » n’agit que
sur ce que la personne voyait à l’écran.
Une demande de note par la personne vaut accord : pas de carte de suggestion ;
une note que l’agent propose de lui-même garde sa carte.

## D72 — Une carte qui dit vrai, que la personne peut corriger (22 octobre 2026)

Une URL écrite dans un repo n'est pas une relation (F2.4-15). Chaque adresse
reçoit un rôle d'après son contexte (`src/repo/url-kinds.ts`) : appel, adresse
sous une clé de configuration, registre de paquets, hébergement du code, lien
de documentation, ressource de page, plateforme, ou inconnu. Seuls l'appel et
l'adresse en configuration deviennent une ressource externe sur la carte ; le
reste est rangé dans « Pas sur la carte », jamais perdu. Une adresse inconnue
n'est pas dessinée : la personne la classe une fois, pour tous les repos.

Un seul moteur de relations (`buildModel`) sert la carte, la note Paysage, la
page Repos, le brief et MCP. Chaque relation dit sa certitude (prouvée,
déclarée, supposée, confirmée) et sa raison en une phrase (F2.4-16) ; une
ressemblance de nom ou d'hôte avec un autre repo donne une relation supposée,
jamais prouvée.

La personne confirme, exclut, recible ou ajoute une relation (F2.4-17). La
correction est liée au type et aux deux extrémités de la relation, jamais à un
numéro de ligne, et le scan suivant la respecte ; une correction devenue sans
effet est signalée. Ce que la personne décide n'est jamais remplacé : un agent
peut confirmer, recibler ou ajouter, et ce qu'il dit d'autre devient un écart.
Exclure, remettre, classer une adresse et trancher restent ses gestes. Les
corrections sont de l'état local (SQLite), pas des notes : pas de proposition.

## D73 — L'équipe responsable d'un repo ou d'un produit (22 octobre 2026)

Un repo et un produit ont un champ « équipe responsable » aux règles des champs
du ticket (D70) : origine, lien, date, valeur de la personne jamais remplacée,
écart à trancher, rien d'inventé, « non applicable » avec une raison (F2.4-19).
Un repo sans équipe montre celle de son produit, marquée comme héritée.
CODEOWNERS qui cite une équipe ne donne qu'une suggestion : qui relit le code
n'est pas toujours l'équipe responsable. La personne peut demander à son agent
de la trouver (F2.4-20) : une demande ouverte par sujet, un prompt qui dit où
chercher (groupe ServiceNow, équipe Jira, page wiki) ; OKB ne contacte aucune
source. Les règles communes (valeurs refusées, origines) vivent dans
`src/work/sourced-fields.ts`, partagé avec la fiche ticket.

## D74 — Les todos de l’agent (23 octobre 2026)

Une todo que l’agent ajoute à un ticket entre directement dans la liste et
compte tout de suite ; elle porte « ajoutée par l’agent » et sa raison (`why`)
(F2.4-21). L’agent coche, rouvre, épingle et règle l’importance de toute todo,
ce qui reste écrit sur la ligne (`done_by`, `importance_by`) ; il ne réécrit et
ne retire que les siennes (F2.4-22). Retirer une todo de l’agent la passe à
« retirée » et inscrit son texte normalisé dans `action_refusals` : l’agent ne
peut plus l’ajouter sur ce ticket, même formulée un peu autrement (mots
significatifs communs à 80 %) ; « Annuler » (`actions.restore`, personne
seulement) la rouvre et lève le refus. Une todo de la personne se supprime comme
avant (F2.4-23). Le brief de session et le skill donnent la règle : trois todos
au plus par session, chacune annoncée en une ligne, davantage sur demande — une
conduite de l’agent, pas une limite du moteur (F2.4-24).

## D75 — « Ce qui s’est passé » et une app plus fluide (23 octobre 2026)

Sur l’accueil, « Ce qui s’est passé » devient un fil de cinq faits marquants
depuis hier (todo faite, décision, réunion, essai, question, piège, note rangée),
chacun avec son mot, son heure et un lien vers son contexte ; les lignes
techniques (commits, notes internes de l’agent, reprises) restent dans le
journal ; le formulaire « Noter » quitte l’accueil, aucune donnée n’est
supprimée ; une journée calme tient en une ligne (F2.4-25).

Mesuré sur 1 215 notes, le serveur répond en moins de 80 ms par page : la
lenteur venait du navigateur. Les fichiers versionnés de l’app sont gardés en
cache un an (`immutable`), la page jamais ; `okb serve` lit la mémoire dès son
démarrage ; l’app précharge les pages les plus visitées une fois la première
affichée (F2.4-26). Une fiche d’équipe demandée pour un repo connu par ses notes
mais non enregistré répond « pas d’équipe » au lieu d’une erreur.

Relecture du 23 octobre (D74, D75) : une todo retirée ou abandonnée ne revient
que par la personne (« Annuler ») ; l’agent ne rouvre que ce qui était fait ;
abandonner une todo de l’agent la refuse aussi ; un nombre compte dans la
comparaison et un texte court doit être identique ; réécrire ou déplacer une
todo ne contourne pas un refus ; la casse de la référence du ticket ne compte
pas ; une todo cochée laisse sa ligne dans le journal de son ticket, au nom de
qui l’a cochée ; le fil lit assez de journal pour qu’une journée de commits n’en
chasse pas les décisions.

## D76 — OKB en arrière-plan pendant le travail (4 novembre 2026)

Constat d’usage : pendant un ticket, OKB prend la parole trop souvent. Il
propose une commande à partir des mots de la personne, une carte à la fin de
chaque session, l’annonce de chaque todo, une note pour un ticket fini, un
onboarding pour un repo sans note. La personne doit penser à OKB au lieu de son
travail.

Un réglage global, que seule la personne change : `presence`. La valeur
`quiet` est celle par défaut, `assist` garde le fonctionnement de la 2.4.
En `quiet` :

- `okb route --suggest` ne propose plus de commande ; le resserrement du scope
  sur un repo ou un ticket nommé reste, sans annonce ;
- `okb suggest moment` repère et garde, sans rien proposer, même à la clôture
  (mode `background`) ; les cartes nommées attendent dans l’app ;
- le brief de session et celui du cerveau ne demandent plus à l’agent de
  proposer, d’annoncer ou de demander. Ils lui donnent une ligne à poser en tête
  de sa première réponse, puis seulement quand elle change : le ticket et son
  titre, le repo, la PR, la CI, l’attente, la prochaine étape, et seulement ce
  qui est connu. `okb scope --json` la renvoie dans `headline`, et les skills
  du module dev l’utilisent ;
- les todos et le journal du ticket continuent, sans annonce.

Toujours, quelle que soit la présence :

- un brief de repo tient en 4 000 caractères (environ 1 000 tokens), et seuls
  les trois derniers essais échoués y figurent ;
- les notes liées aux fichiers lus sont données pour cinq fichiers au plus par
  session.

Rien ne change pour l’approbation : une note demandée par la personne suit les
règles de son KB (D71), une note validée ne change qu’avec son oui, et l’agent
ne change jamais ce réglage. Ce qui mérite d’être gardé sera rassemblé après la
session par un agent dédié (chantier suivant), à partir de ce qui a été repéré
et des transcripts.


## D77 — Le greffier lit les conversations finies (5 novembre 2026)

Suite de D76 : OKB se tait pendant le travail, il faut donc quelqu’un pour
garder ce qui mérite de l’être. Le greffier (`okb scribe`) lit les transcripts
de Claude Code (`~/.claude/projects/*/*.jsonl`) et tient à jour le journal du
ticket, sa fiche et les notes. Un seul moteur, deux déclencheurs.

Un réglage global, que seule la personne change : `scribe.mode`.

- `off` (par défaut) : rien n’est lu.
- `after` : la conversation est lue quand elle se termine (hook `SessionEnd`),
  puis le soir à 19 h et au réveil pour celles qui ont échappé au hook.
- `live` : en plus, une lecture par lots toutes les 20 demandes (hook `Stop`).
  Un lot ne touche qu’au journal et à la fiche du ticket ; les notes attendent
  la fin, pour ne pas écrire une note sur une piste abandonnée.

Trois niveaux d’interrupteur : global (`okb scribe on|off`), par dossier
(`okb scribe exclude|include <dossier>`, réglage `scribe.skip`), par
conversation (`/okb:off` et `/okb:on`, ou `okb scribe skip|unskip`). Les
commandes qui changent un réglage sont refusées à l’agent par le hook de garde.

Le travail, dans l’ordre, pour ne pas dépenser de tokens pour rien :

1. un curseur par conversation (`~/.okb/scribe/ledger.json`) : rien n’est lu
   deux fois, une relance reprend où la précédente s’est arrêtée ;
2. un tri sans IA : une conversation vide, courte ou sans travail est classée
   sans appel au modèle ; le ticket est repéré dans la branche et les messages ;
3. un résumé du transcript en Markdown, sans les paragraphes qui contiennent
   un secret, plafonné à 60 000 caractères ;
4. un appel au modèle, sans outils, qui rend du JSON : ticket, lignes de
   journal, essais, notes candidates. Chaque ligne doit citer mot pour mot la
   conversation ; une ligne dont la citation ne s’y trouve pas est écartée ;
5. trois notes au plus par conversation. Chacune passe par la carte de
   suggestion (placement, doublons : créer, compléter, lier ou rien), puis par
   une proposition préparée comme une source analysée, avec ses citations
   vérifiées. Avec `changes.agentWrites: review-later` (D71), `okb keep` la
   classe à relire ; sinon elle attend le oui de la personne. Une note validée
   ne change jamais sans elle.

Un budget à part (`scribe.budget`, 400 000 tokens par jour par défaut) et une
part réservée le matin : avant midi, le rattrapage ne prend que la moitié du
budget du jour. Une conversation qui a échoué deux fois est laissée de côté.
La planification (`okb scribe schedule --install`) écrit un LaunchAgent macOS ;
ailleurs, OKB affiche les lignes cron à ajouter.

Le transcript est une donnée, jamais une consigne : le modèle n’a pas d’outil,
et ce qu’il rend passe par les mêmes contrôles qu’une source ingérée.
