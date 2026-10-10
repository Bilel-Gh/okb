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
