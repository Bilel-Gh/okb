# Architecture et décisions

## Frontières de responsabilité

Le plugin orchestre le travail intellectuel dans Claude. Le CLI s’occupe des
opérations reproductibles. Obsidian reste un lecteur/éditeur des fichiers ; il
n’est pas nécessaire pour exécuter les tests. Aucun MCP n’est requis par défaut.

```mermaid
flowchart TD
  S[Source] --> N[Extraction bornée]
  N --> A[Analyse par Claude]
  K[KB privée] --> R[Recherche et vocabulaire]
  R --> A
  A --> P[Proposition immuable]
  P --> V[Revue des preuves]
  V --> H[Approbation de la sélection]
  H --> B[Reçu initial et sauvegardes privés]
  B --> W[Écriture contrôlée]
  W --> K
  W --> J[Reçu finalisé]
```

Le dossier d’analyse porte les blocs déclarés lus, les affirmations rapportées ou
déduites et leurs extraits exacts. Le noyau vérifie les identifiants et les citations ;
le réviseur évalue si elles soutiennent réellement le texte. Aucun test structurel
ne transforme une affirmation en fait techniquement vérifié.

## Modules

| Module | Contrat |
|---|---|
| `sources/` | acquisition limitée, adaptateurs, blocs normalisés et localisateurs |
| `pipeline/analysis.ts` | dossier v1/v2, couverture déclarée sur toutes les sources, identité des extraits, aides reliées aux affirmations, rendu stylé |
| `kb/`, `concepts/` | recherche locale, alias, sens, propositions de définitions et de liens |
| `proposal/` | contenu exact, dépendances, sélection, hash recalculable, validation, combinaison de propositions |
| `apply/` | autorisation, limites de chemin, verrou, préparation durable, reprise et rollback |
| `config/`, `setup/` | profils privés, précédence, restrictions cumulées |
| `okf/`, `links/`, `markdown/` | format ouvert, références relatives, modifications par positions AST |
| `nav/`, `migrate/`, `maintain/` | opérations d’entretien utilisant le même contrat de proposition |
| `style/` | préréglages, résolution par couches et demande ponctuelle, brief de rédaction, libellés fixes |
| `templates/` | modèles de notes (sections, ordre, titres, consignes), surcharges par KB |
| `categories/` | catégories de notes (couleur, emoji, modèles, types, dossiers), déduites sans rien écrire ; surcharges `.okb/categories.yaml` ; changement par proposition |
| `kb/graph.ts` | le graphe de la KB : nœuds, liens exacts (Markdown analysé), prérequis, rétroliens, comptes par catégorie |
| `revise/` | révision du style d’une note : éléments protégés, frontmatter, proposition de remplacement |
| `engine/` | les opérations écrites une fois (entrée validée, module, effet), `invoke`, et `okb mcp` pour les assistants |
| `projects/` | le Projet, les actions, le journal, « Où j'en étais », Aujourd'hui ; les sources que les modules déclarent (`sources.ts`) |
| `state/db.ts` | l'état opérationnel dans SQLite (`okb.db`, par profil, hors des notes) |
| `share/` | copie Git commune distincte, manifeste des tiroirs, aperçu exact, recherche attribuée et conservation par proposition |
| `understanding/` | lectures dérivées en cache, gestes déclarés, dette, préparation de réunion et progression privée |
| `assistant/` | processus CLI local borné, conversations privées, validation des citations, journal d’usage et actions explicites |
| `work/ticket-state.ts`, `work/ticket-external.ts` | états indépendants et critères des tickets, lectures GitHub opt-in et observations Jira déclarées |
| `desktop/` | coque Electron, serveur loopback partagé, preload limité, cycle de vie et mises à jour signées |
| `modules/wire.ts` | le seul fichier qui connaît tous les modules : chacun y déclare ce qu'il apporte au cœur |
| `web/` | serveur local et API vers le moteur ; session, contrôles d’origine et approbation réservée à la personne |
| `security/` | détection des secrets (clés, jetons, identifiants) dans propositions, captures, focus et notes |
| `inbox/`, `weekly/` | inbox privée hors KB, revue hebdomadaire en lecture seule avec relectures espacées |
| `focus/` | note de focus et journal des sessions, hors KB ; contexte donné au démarrage d’une session |
| `skillify/` | brouillon de skill Claude Code à partir d’une note procédure, process ou automatisation |
| `repo/` | repos de code : carte déterministe, plan de lecture, 25 questions d’onboarding, dossier v3 cité à la ligne, fraîcheur Git, ticket, paysage multi-repos, confidentialité (voir [REPOS.md](REPOS.md)) |
| `plugin/` | quatorze skills, dix-neuf commandes, trois agents, trois hooks (garde d’approbation, focus et repo au démarrage, intentions) et `bin/okb` |

## Un seul moteur

Une action d'OKB s'écrit une fois, comme opération (`src/engine/`, D58), avec son
module, son effet (`read`, `state`, `propose`) et son entrée validée par zod.
`invoke` la lance pour le web, la CLI et `okb mcp`. Le contexte dit qui demande :
un agent (Claude par la CLI, un assistant par MCP) ne voit jamais une note 🔒.
Approuver, appliquer et décider d'une carte ne sont pas des opérations.

Un module éteint masque ses opérations. `tests/module-boundary.test.ts` interdit
au cœur d'importer le code du module développeur (`repo/`, `work/`, `arch/`,
`dev/`, `knowledge/`), sauf une dette listée qui ne peut que diminuer.

## L’assistant et l’application native

Le transport de l’assistant appelle une CLI installée par la personne. Il
conserve ses réglages et son authentification, dans un dossier de travail OKB
vide. La porte `ai/gate.ts` contrôle le message final, la confidentialité et le
budget. Après connexion explicite, les demandes de traduction, lecture et
examen utilisent ce même agent ; les anciens profils restent compatibles.

Les conversations ont leurs tables dans `okb.db` (migration 5), les lectures et
gestes de compréhension les leurs (migration 6), les tickets passent des JSON
existants à SQLite (migration 7). Une empreinte et une citation prouvent quels
octets ont été utilisés, pas la vérité de l’affirmation. Un appel interrompu ou
mal formé reste compté lorsque la CLI fournit son usage ; sinon la mesure est
indisponible et le budget porte une estimation explicite.

Electron sert les mêmes fichiers web avec le même moteur et sa propre version
de Node. La fenêtre n’a pas d’accès Node ; seul le preload expose choix de
dossier et mises à jour. Le serveur écoute sur loopback avec un port libre.
Fermer l’application ou installer une mise à jour arrête ses agents avant de
fermer SQLite. Les builds de prototype restent sans mises à jour ; la
distribution signée fixe deux canaux HTTPS et une identité d’éditeur.

## Les documents

Un fichier que la personne garde va tel quel dans `_Documents/<année>/` (D61,
`src/documents/`). C'est la seule écriture directe dans le dossier des notes, et
elle est réservée à la personne. Le chargeur de KB ignore ce dossier : un
document n'est pas une note. La liste et le texte lu (FTS5) sont dans `okb.db`.

## Durer

La sauvegarde (`src/brain/backup.ts`) copie les notes, l'état (la base par
`VACUUM INTO`) et les réglages ; `drillRestore` essaie une restauration dans un
dossier temporaire. `src/migrate/v2.ts` fait passer un cerveau de la 1.5 à la
2.0 (essai à blanc, application, retour). `src/indicators/indicators.ts` donne
quatre indicateurs séparés. Les parcours (`tests/journeys/`) pilotent
l'application construite dans un vrai navigateur ; les pannes sont dans
`tests/failures.test.ts` (D63).

## Les espaces

Chaque cerveau est dans Mon bagage ou dans Travail (`src/spaces/space.ts`, D62).
Le seul pont est `keepInBaggage` (`src/spaces/baggage.ts`) : il lit une note de
travail, retire ce que `src/spaces/details.ts` reconnaît du lieu de travail,
revérifie le texte final et prépare une proposition dans le bagage. Les packs
refusent le bagage dans les deux sens.

## Le oui

Ce que la personne écrit (captures, journal, actions, documents) est direct.
Ce qu'un assistant prépare attend : `eveningView` (`src/evening/evening.ts`)
rassemble les cartes et les changements, `sayYes` approuve un lot après une seule
confirmation de présence. `sayYes` n'est pas une opération du moteur.

## Les moments d'une conversation

Le hook de fin de réponse passe à `okb suggest moment` le dernier échange, les
messages précédents de la personne et l'identifiant de session. Le repérage
(`src/suggest/moments.ts`) est une fonction pure, sans IA. Les règles d'une
session (`src/suggest/session.ts`) décident quoi proposer : rien en cours de
route, trois choses au plus à la clôture, « pas maintenant » retenu (D61).

## Lire une KB par révision

Toute requête commence par `loadBundle` (D57). Une KB inchangée ne coûte que la
liste de ses fichiers et leurs tampons (inode, taille, dates) : le même objet
`Bundle` revient, et les vues qui en dérivent (index de recherche, scores) restent
valables tant qu'il est le même. Seules les notes changées sont relues. L'analyse
du Markdown d'un texte (liens, ancres, titres) est faite une fois et partagée
(`bodyFacts`). L'application d'une proposition relit le disque (`fresh`).

`npm run bench:speed` mesure la vitesse sur des cerveaux fictifs de 415 à 4 715
notes, sans IA. Cible de la 2.0 : une recherche répétée sous 200 ms au p95 à
5 000 notes.

## Choix assumés

**Fichiers avant base vectorielle.** Les notes restent lisibles, diffables et
transportables. La recherche actuelle est lexicale, avec titres, alias, rubriques
et extraits. Claude peut reformuler une recherche. Un index sémantique pourra être
ajouté comme cache dérivé, jamais comme source canonique. Aucune promesse de rappel
sémantique universel n’est faite pour cette version.

**Configuration plutôt que forks personnels.** Les profils portent le domaine,
la langue et le niveau d’assistance. Une couche équipe est distincte de la couche
organisation. Les listes d’interdiction s’unissent ; chaque groupe d’autorisation
d’écriture doit accepter le chemin ; les plafonds prennent le minimum. Les
préférences ne rétablissent pas une permission interdite par une couche supérieure.
Un profil demeure modifiable par le propriétaire de la machine : ce n’est pas un
service d’administration central avec identité forte.

**Sources complètes, sorties bornées.** Les blocs trop longs sont fractionnés sans
perte de texte. Les pages respectent un budget estimé et un curseur. Le snapshot
normalisé est conservé hors KB ; `--run` le réutilise sans relire le réseau. Le
curseur signifie « livré au caller ». La couverture sémantique est déclarée dans
le dossier puis contrôlée par revue, pas déduite du nombre de tokens envoyés.

**Le style est un paramètre, pas une réécriture.** Le brief est généré à la
demande depuis quelques valeurs du profil ; le style utilisé est figé dans le
dossier et dans `x_okb.writing`. Les faits restent des affirmations sourcées ;
les analogies, schémas et exemples sont des aides rattachées à ces affirmations.
Voir [STYLE.md](STYLE.md).

**Des modèles pour que la KB reste lisible en grandissant.** Chaque note suit un
modèle (guide, concept, procédure, retour d’expérience, décision, réunion) qui
fixe ses sections et leurs titres ; le CLI refuse un dossier qui s’en écarte. Voir
[TEMPLATES.md](TEMPLATES.md).

**Propositions avant mutations.** Import, navigation, migration et déplacement
produisent le même objet. Un déplacement est un groupe indivisible. Le hash porte
sur le contenu, les preuves, dépendances, profil et KB. Une approbation vise la
sélection exacte. La sélection modifie le résultat : une approbation de tous les
changements ne vaut donc pas pour n’importe quel sous-ensemble.

**Écritures récupérables.** Tous les résultats sont matérialisés et contrôlés avant
la première mutation. Sauvegardes et contenus attendus utilisent des noms dérivés
du hash du chemin, sans collisions entre `a/b.md` et `a__b.md`. Un reçu incomplet
existe avant l’écriture. Au redémarrage, chaque fichier doit correspondre à son
état initial ou à son résultat attendu ; la reprise reconnaît même le crash situé
entre `rename()` et le journal. L’annulation précontrôle tous les fichiers et
refuse les modifications ultérieures. Les fichiers sont atomiques séparément,
mais un lecteur externe peut observer un lot partiellement appliqué.

L’état de départ est revérifié pendant la préparation des écritures : une
édition Obsidian entre le contrôle initial et la lecture à sauvegarder n’est pas
adoptée silencieusement comme nouvelle référence. La reprise revalide le résultat
structurel et les liens sur la KB courante avant ses prochains fichiers.

**Fraîcheur sur demande.** L’entretien peut comparer une référence locale à son
empreinte d’ingestion à partir des métadonnées privées déjà présentes. Il ne
recontacte pas les URL et n’interprète pas le changement de contenu. Une comparaison
impossible reste « inconnue », et aucune note n’est réécrite automatiquement.

**Lecture avant approbation.** Le serveur local réutilise recherche et
matérialisation du CLI, affiche des données via DOM texte et accepte uniquement
des lectures depuis son origine sur 127.0.0.1. L’approbation reste dans le terminal.
Ce choix réduit le coût de revue sans ajouter un second moteur d’écriture.

**Une intelligence éditoriale, pas un générateur de fiches vides.** Les heuristiques
remontent des termes et les définitions explicites. Le dossier peut proposer des
notions sémantiquement utiles avec preuves. Les sens ambigus ne sont pas fusionnés.
Les prérequis d’un article ne deviennent pas automatiquement ceux d’un nouveau
concept. Les liens sont planifiés par section et chaque lien dépend seulement de
sa cible. Les citations, le code et les liens existants sont protégés.

**Conservation des intentions éditoriales.** Les opérations Markdown utilisent
les positions de l’AST et modifient les sous-chaînes concernées. Un déplacement
recalcule les destinations entrantes et sortantes ; une migration n’utilise pas
un remplacement global de texte. Le YAML conserve les champs inconnus. Le formatage
YAML peut changer pour une clé modifiée ; le corps ne subit pas de réécriture globale.

## Ce que « devient plus intelligent » signifie ici

Les nouvelles notes validées, les alias, les définitions et les préférences connues
enrichissent les prochains résultats. Le logiciel n’entraîne pas Claude et ne
déduit pas automatiquement un profil psychologique. Les corrections de savoir
passent par une proposition. Pour aller plus loin, mesurer d’abord les réponses
utiles, les fausses attributions et le temps de revue sur un corpus représentatif.


## Lire l’architecture d’un espace de travail

Le modèle déterministe garde tous les nœuds, toutes les relations et les repères
fichier:ligne (`src/arch/model.ts`). Le scan reste statique : une méthode Fetch
calculée, des options variables ou un spread restent `ANY`, et une correspondance
avec cette méthode inconnue reste probable. La variable de base nommant un repo
limite les candidats avant la correspondance de chemin et de méthode ; un conflit
avec les routes de ce repo devient une question. Une relation regroupant plusieurs
appels conserve la confiance la plus faible. Une dépendance de technologie de
base de données indique une utilisation possible, jamais une instance ou une base
partagée prouvée. Les données détectées restent séparées par repo tant que leur
identité commune n’est pas établie.

L’écran Architecture commence avec un repo et huit éléments au plus : le repo
choisi et ses voisins entrants et sortants. Le nom complet se répartit sur plusieurs
lignes ; le texte reste à 100 % et le dessin peut défiler. Les retours et les appels
sautant une colonne ont des voies distinctes au-dessus du dessin ; les autres liens
passent entre les colonnes, hors des labels. Les verbes et les méthodes se lisent
dans la liste des relations et dans les preuves du lien sélectionné, pour éviter
l’empilement de textes sur les flèches. Un point d’interrogation marque chaque lien
incertain ; le statut reste aussi écrit dans la liste.

Les comptes précisent les éléments et relations hors du dessin, ainsi que les
voisins directs masqués. Les groupes par nature (repos, bases, systèmes externes)
peuvent être ouverts pour choisir un membre ou développés dans le dessin. Toutes
les relations restent accessibles dans la liste, avec leurs noms complets,
méthodes, confiance et accès aux preuves des deux côtés lorsqu’elles existent.
Sélectionner un repo recadre son voisinage ; choisir un lien ajoute ses deux
extrémités au dessin. Sur téléphone, le panneau de preuves et la liste passent
sous le graphe ; choisir une relation place le focus clavier sur les preuves.

Les exports conteneurs et contexte gardent douze boîtes au plus et décrivent les
membres de chaque groupe (`View.groups`). Les liens entrants, sortants et internes
aux groupes gardent leurs identifiants et leurs preuves. L’interface travaille
sur le modèle complet pour développer ces groupes ; copier en Mermaid exporte
le dessin visible, pas une version arbitrairement tronquée du système. Les
parcours listent douze relations à la fois, signalent celles qui restent et
permettent de continuer. `View.omittedRelations` décrit aussi les identifiants
omis dans un export borné. Tous les candidats d’un premier appel ambigu restent
présents. Un parcours représente les dépendances possibles accessibles depuis
cet appel : il ne prouve pas leur ordre d’exécution ni leur causalité avec une
route particulière. Le score affiché est un contrôle de structure, pas une
certification de vérité.

Les régressions couvrent méthodes dynamiques, conflits de périmètre, confiance
mixte, groupes, bases communes ou isolées, noms longs, cycles et auto-appels.
`tests/journeys/architecture.journey.ts` inspecte l’application construite dans
Chromium à 1440, 1280 et 390 pixels, vérifie l’absence de collision entre noms et
de débordement de page, l’expansion et l’accès clavier aux preuves. Les captures
se placent dans le dossier temporaire de la machine, avec le préfixe
`okb-architecture-`. Ces fixtures fictives ne reproduisent pas le graphe réel de
la personne et ne valident pas tous les frameworks ou tous les navigateurs.

## La fiche d’un ticket (D70)

`src/work/ticket-sheet.ts` assemble la fiche à partir de l’état SQLite :
`ticket-fields.ts` (champs, origine, écarts, non applicable),
`ticket-next.ts` (prochaine étape = première todo, `actions.ticket_ref`),
`ticket-completeness.ts` (calcul pur), `ticket-links.ts` (métadonnée `tickets`,
note du ticket, liens à la main, mentions suggérées), `ticket-requests.ts`
(demandes à l’agent et prompt) et `ticket-migrate.ts` (reprise unique des
tickets 2.0 après la copie `state-v<N>-…db`). Les opérations `tickets.sheet`,
`tickets.field.*`, `tickets.links.*`, `tickets.requests.*`, `actions.delete`
servent le web, la CLI et MCP. L’accueil reçoit les cartes par le contrat
`ProjectSource.cards` / `pendingRequests` : le cœur ne connaît pas les tickets.

## La carte qui dit vrai et l’équipe responsable (D72, D73)

`src/repo/url-kinds.ts` donne un rôle à chaque URL trouvée par le scan
(`Iface.role`) ; une carte plus ancienne est classée au calcul depuis sa ligne de
preuve. `src/arch/model.ts` (`buildModel`) ne dessine en ressource externe que
les appels et les adresses en configuration, range le reste dans `offMap`, et
porte sur chaque lien `certainty`, `basis` et `origin`. `src/arch/overrides.ts`
applique les corrections de la personne (`arch_overrides`, `arch_conflicts`,
`arch_url_rules`) ; `correctedModel` (`src/arch/system.ts`) est le passage
obligé de la carte, de la note Paysage (`landscapeEdges` en est une vue), du
brief et de `arch.map`. Les gestes sont des opérations `arch.*`
(`src/arch/operations.ts`). L’équipe responsable est un champ sourcé
(`src/work/sourced-fields.ts`, tables `subject_*`) lu par `src/work/team.ts` (héritage
du produit, suggestion CODEOWNERS, demandes à l’agent) et servi par les
opérations `team.*`. Les deux ajoutent une seule entrée à `MIGRATIONS`.

