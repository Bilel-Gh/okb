# Repos de code : conception

Objectif : qu’une personne qui ne connaît rien à un repo puisse y travailler vite,
et que la connaissance acquise (onboarding, puis chaque ticket) vive dans une KB
fiable. Le guide utilisateur est [docs/guide/repos.md](../guide/repos.md).

## Principes

1. **D’abord une carte déterministe, ensuite l’IA.** `okb repo scan` inventorie tout
   le repo en quelques secondes, sans exécuter ni réseau : c’est la garantie contre
   « un résumé qui oublie l’important ».
2. **Une liste fixe de 25 questions** (`src/repo/questions.ts`), en six thèmes. Chacune
   finit citée, déduite (marquée) ou **inconnue** avec où chercher et à qui demander.
   Les réponses humaines sont des sources datées, jamais un prérequis.
3. **Le code se cite comme du code** : dossier v3, `file` + `lines` + `quote`. Le noyau
   découpe les extraits, vérifie chaque citation contre le fichier actuel et convertit
   en dossier v2 : rendu, notes de bas de page, fiches concepts, revue et application
   restent ceux de toute la KB.
4. **Les schémas sont ancrés** : `nodes` relie chaque boîte Mermaid à un chemin réel
   ou à `external:<système>` ; une boîte non reliée ou un chemin absent est refusé.
5. **La fraîcheur suit Git** : chaque note garde `x_okb.repo.commit` ; ses sources
   (`<repo>/<chemin>`, `urn:sha256:`) et les ancres d’état disent ce qu’elle cite.
6. **Confidentialité** : une KB `kb.confidential` refuse le web, le wizard ne crée pas de
   GitHub, `okb doctor` signale dossier synchronisé (iCloud, OneDrive…) et remote Git.

## Flux

```mermaid
flowchart LR
  S[okb repo scan] --> M[(map.json + git-facts.md)]
  M --> P[okb repo plan]
  P --> E[agents okb-repo-explorer]
  E --> F[okb repo findings add]
  F --> D[dossiers v3]
  A[okb repo answer] --> D
  T[okb repo ticket] --> D
  D --> W[okb repo write]
  W --> R[proposition]
  R --> V[relecture + approbation humaine]
  V --> K[(KB : repos/id/…)]
  K --> U[okb repo update]
  U --> D
```

## Modules (`src/repo/`)

| Fichier | Rôle |
|---|---|
| `registry.ts` | `~/.okb/repos.yaml` : repo → KB ; résolution par chemin (physique), puis par remote après un nouveau clone |
| `git.ts` | lecture seule : identité, fichiers (`ls-files`), historique sur un an, diff, base de branche, commits |
| `inventory.ts` | classement de chaque fichier (doc, manifeste, interface, code, test…) et contenu texte borné |
| `detect.ts`, `interfaces.ts`, `insight.ts` | stack, commandes, docs, CI, tests, publié/exposé/appelé, variables, environnements, entités, modules, propriétaires, points chauds, modules centraux, vocabulaire, risques et divergences doc/code |
| `scan.ts` | assemble la carte, le plan de lecture par niveaux (lire / parcourir / indexer / ignorer, avec budget) et les faits Git citables |
| `questions.ts` | les 25 questions et leurs pistes issues de la carte |
| `dossier.ts` | dossier v3 → extraits exacts + dossier v2 ; ancrage des schémas |
| `notes.ts` | écriture d’une note du pack, trouvailles des agents, réponses humaines |
| `status.ts` | état (notes, couverture, questions) et fraîcheur |
| `ticket.ts` | contexte d’une branche terminée, citable |
| `generated.ts` | notes générées : questions ouvertes, paysage multi-repos |
| `pack.ts` | les sept notes du pack, leurs fichiers et titres |
| `confidential.ts` | dossiers synchronisés, remotes |

Plugin : skills `okb-onboard` et `okb-repo-learn`, agent `okb-repo-explorer`,
commandes `/okb:onboard`, `/okb:ticket`, `/okb:repo`, `/okb:workspace`, brief du
périmètre au démarrage de session, intentions « je découvre ce repo », « je
commence / j’ai fini mon ticket » et « un dossier avec tous mes repos ».

## Espace de travail, périmètre et tickets (`src/work/`)

Un **espace de travail** relie un dossier de repos à une KB. Le **périmètre** est
le repo (et le ticket) sur lequel OKB se concentre. Un **ticket suivi** garde son
point de départ, sa branche, ses commits et un journal. Tout est état local :
rien n'entre dans la KB sans proposition approuvée.

| Fichier | Rôle |
|---|---|
| `workspaces.ts` | `~/.okb/workspaces.yaml` : dossiers → KB, préfixes de tickets appris des branches et des commits ; découverte des repos (deux niveaux, KB exclues) ; lecture des références `ABC-123` |
| `scope.ts` | résolution du périmètre (dossier du repo, sinon choix mémorisé dans `~/.okb/scope.yaml`) ; bascule quand un message nomme un repo ou un ticket |
| `tickets.ts` | tickets dans l'état privé de la KB (`tickets/<REF>.json`) : départ (merge-base), branche reconnue ou adoptée, commits relevés dans le journal (survivent au squash), mergé ou supprimé, note écrite ou non |
| `rank.ts` | classement dans un périmètre : notes du repo, notes communes liées (liens sortants, entrants, mentions), voisins, autres repos |
| `brief.ts` | le brief de Claude (≈ 20 lignes) ; liens entre repos de l'espace mis en cache (`repos/edges-<espace>.json`) tant qu'aucune carte ne change |
| `kinds.ts` | les trois types de KB (`kb.kind` : `topic`, `repo`, `workspace`) ; type déduit pour les KB d'avant 0.10 |
| `cli-scope.ts` | `okb ask` dans le périmètre ; pour un repo rattaché, sa KB puis la partie commune de l'espace, en une liste |
| `merge.ts` | fusion d'une KB de repo dans un espace : une proposition sous `repos/<id>/`, puis l'état privé, les tickets et l'enregistrement |
| `graph-view.ts` | ce que le graphe web dessine d'un espace : repos, liens de code, périmètre, tickets |

Branchements :
- `okb ask` applique le périmètre (sauf `--everywhere`) ;
- `effective()` choisit la KB de l'espace quand on est dans son dossier ;
- `okb status --brief` ajoute `📦 repo · 🎫 ticket` ;
- hooks : `SessionStart` → `okb scope --context`, `UserPromptSubmit` →
  `okb route --suggest --cwd` (bascule et brief), `PostToolUse` sur `git commit` →
  `okb ticket commit` ;
- `okb repo write --append|--create` hors de `repos/` laisse la note commune
  (aucun tampon `x_okb.repo`).

Coût : aucun appel de modèle. Le brief remplace l'exploration du code en début de
session ; le rappel après commit fait une ligne.

## Ce que le noyau vérifie, et ce qu’il ne vérifie pas

Vérifié : chaque citation existe mot pour mot dans le fichier cité (lignes trouvées
ou corrigées), les fichiers restent dans le repo (ou sont des sources externes
explicites), les nœuds de schéma pointent vers des chemins réels, aucune valeur
secrète n’entre dans une trouvaille, une réponse ou une proposition, le modèle de
note est respecté.

Non vérifié : qu’une citation soutient l’affirmation (rôle du réviseur), qu’un code
se comporte comme il est écrit (OKB n’exécute rien), l’exhaustivité de la lecture
(déclarée par les agents, mesurée et affichée, jamais présumée).

## Choix et limites

- **Trois types de KB.** Une KB de repo garde ses notes à la racine (`isFlat`, `repoFolder(id, flat)`) ;
  un espace de travail les range sous `repos/<id>/`. Une KB de repo dans un espace est
  « rattachée » : la portée (`Scope.shared`) ajoute la KB de l'espace pour la partie commune,
  et `okb repo write --to-kb` y écrit, seulement hors de `repos/`.
- **Une KB de travail, un dossier par repo**, plutôt qu’une KB par repo : vocabulaire
  métier partagé, paysage multi-repos, un seul endroit à relire. Une KB par repo reste
  possible (`okb repo add --kb`).
- **Rien n’est écrit dans le repo de l’entreprise.** Partager la KB avec l’équipe
  (un `docs/` dans le repo) est une évolution possible, sur demande explicite.
- La détection est heuristique (regex et manifestes) : elle oriente la lecture, elle ne
  remplace pas la lecture ; un faux négatif devient une question ouverte, pas un fait.
- Les gros dépôts : plafond de 60 000 fichiers inventoriés, budget de lecture prioritaire
  (80 fichiers, 15 000 lignes) puis zones déléguées ; l’avancement persiste entre sessions.
