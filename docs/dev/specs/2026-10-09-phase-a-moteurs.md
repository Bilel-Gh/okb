# Phase A — les moteurs de la 1.1

> Spec écrite la nuit du 8 au 9 octobre 2026, en autonomie (carte blanche de
> l'utilisateur). Chaque choix marqué **[à valider]** est une décision prise seul,
> à relire au réveil. Source des besoins : le carnet « après la 1.0 » (§3.1, §3.3,
> §5.1, §7, §9, §13).

## But

Préparer, sans interface, tout ce dont les pages de la 1.1 ont besoin. La refonte
React (phase B) construira directement les nouvelles pages sur ces moteurs, pour
ne pas dessiner deux fois.

Chaque moteur est utilisable de trois façons : la CLI, l'API du site local, et
Claude (par la CLI). Tout est calculé **sans IA**, sauf la traduction.

## A1. Modules, droits et identité

### Modules (§13.1, §9)

Un catalogue dans le moteur, `src/modules/catalog.ts` :

| id | Statut | Plugin Claude | Apporte |
|---|---|---|---|
| `core` | toujours actif | `okb` | cerveau, cartes, recherche, apprendre, carrière, sauvegardes |
| `dev` | disponible | `okb-dev` | produits, repos, tickets, barre de connaissance, diagrammes |
| `devops` | prévu | — | runbooks, incidents, post-mortems, infra |
| `sales` | prévu | — | comptes, clients, concurrents, comptes rendus d'appels, offres |

- Chaque module déclare : `id`, nom et description (FR/EN), `status`
  (`core` · `available` · `planned`), `plugin` (nom du plugin Claude ou rien),
  `features` (identifiants de fonctions qu'il débloque : `repos`, `tickets`,
  `products`, `knowledge-level`, `diagrams`…), `profiles` (dev, devops…),
  `license` (`free` pour l'instant).
- **Activé ou non** : réglage global `modules.enabled` (liste). Par défaut :
  `['dev']` pour ne rien casser chez les gens qui utilisent déjà les repos.
  **[à valider]**
- **Droits (entitlements)** : `entitled(module)` est vrai pour un module `free`.
  Un module payant sera vérifié plus tard par une licence locale signée, **sans
  changer les appels** : tout le code passe par `featureOn(feature)`, qui combine
  « activé » et « droit ».
- **Côté Claude Code** : `claudeModules()` lit `installed_plugins.json` pour dire
  si `okb@okb` et `okb-dev@okb` sont installés.
- **Installer depuis le site** (§7) : `installClaudeModule(id)` lance `claude
  plugin marketplace add <dossier OKB>` si besoin, puis `claude plugin install
  <plugin>@okb`, et renvoie les étapes. Seulement sur un clic de la personne (route
  POST protégée par le jeton), jamais tout seul.
- CLI : `okb modules` (liste), `okb modules on|off <id>`, `okb modules install <id>`.
- API : `GET /api/modules`, `POST /api/modules/toggle`, `POST /api/modules/install`.

### Identité (§13.2)

- Réglages globaux `person.id` et `person.role`.
  - `person.id` : un identifiant stable, généré une fois (`p-` + 10 caractères
    aléatoires), jamais dérivé d'un nom, d'un e-mail ou du compte de l'ordinateur.
  - `person.role` : `dev` · `devops` · `sales` · `product` · `other` · vide.
- Écrits dans chaque **reçu d'application** (`appliedBy` reste, on ajoute
  `person: { id, role }`) et dans les décisions de suggestions. Le futur serveur
  d'équipe et la réputation des relecteurs s'appuieront dessus.
- `okb whoami` montre l'identifiant et le rôle ; `okb settings set person.role dev`.

## A2. Les repos d'un cerveau et leur niveau de connaissance

### Les repos du cerveau (§9)

`GET /api/repos` liste aussi les dossiers `2 Produits/<produit>/Code/<repo>/` qui
ne sont pas enregistrés sur la machine (la démo, un cerveau reçu d'un collègue),
avec `linked: false`. `POST /api/repos/link {folder, path}` les relie à un dossier
de code (même chose que `okb repo add <path> --product <produit>`).

### La barre de connaissance (§5.1)

`src/knowledge/level.ts`, sans IA. Cinq parts :

| Part | Poids | Mesure (0 à 1) |
|---|---|---|
| `questions` | 30 | questions d'onboarding répondues (note écrite) ; « reçue » ou « trouvée » vaut ½ |
| `notes` | 25 | pages attendues du repo présentes ; une page « changée » vaut 0,6, « obsolète » 0,3 |
| `coverage` | 20 | fichiers clés lus (le plan « lire ») + ½ des fichiers à survoler |
| `work` | 15 | mémoire du travail : tickets, enquêtes, erreurs connues, recettes, décisions, conventions ; 6 notes ou plus = plein |
| `quality` | 10 | moyenne des scores de qualité des notes du repo |

- Pages attendues : la page du repo (aperçu), Démarrer, Architecture, Interfaces,
  Livrer, Carte du code ; dans un cerveau, aussi Tester et Déboguer.
- **Vieillissement** : les pages changées ou obsolètes comptent moins (ci-dessus),
  et une question répondue dont la note est obsolète vaut ½.
- **Repo non relié** : seules `notes`, `work` et `quality` se mesurent ; le
  pourcentage est rapporté à ces 50 points et marqué `partial` (« relie le code pour
  mesurer le reste »).
- **Paliers** : Découverte (0–19) · Utilisable (20–44) · Solide (45–69) ·
  Expert (70–89) · Référence (90–100).
- **Pour passer au palier suivant** : chaque manque est chiffré en points
  (`+6 pts : écrire « Démarrer »`) ; on montre les 3 qui rapportent le plus.
- CLI : `okb repo level [<repo>]` ; API : dans `GET /api/repos` (chaque repo) et
  `GET /api/repo`.

## A3. Les concepts « En une phrase » (§3.3)

- **Une seule source** : la phrase vit dans le texte de la fiche, sous le titre
  « En une phrase » (ou, à défaut, « En bref »). Pas de champ caché : la personne
  la corrige dans son éditeur. **[à valider]**
- `oneLiner(doc)` extrait la première phrase de cette section, enlève un « Terme : »
  en tête, et la valide : 3 à 25 mots, pas de lien, pas de code, pas de
  répétition du seul terme. Sinon : `null`, avec la raison (`missing`, `too-long`,
  `too-short`).
- **Au survol** : `GET /api/note` renvoie pour chaque terme `oneLiner` (ou `null`).
  Le site n'affiche une bulle que s'il y a une phrase (titre du concept, la phrase,
  « Lire la fiche → ») ; sans phrase, le mot reste un simple lien.
- **Qualité** : une fiche concept sans phrase valide perd 4 points de structure,
  avec la note « no one-line definition ».
- **Suggestions** : `okb concepts check` liste les fiches sans phrase valide ;
  `--suggest` ajoute pour chacune une carte « compléter » (signal `concept`) que la
  personne accepte ou non.
- Le relecteur qualité (agent) reçoit la règle dans sa grille.

## A4. Le fournisseur d'IA et la traduction

### Fournisseur (§2.B : « prévoir les deux »)

`src/ai/provider.ts` :

- `claude-code` : lance `claude -p` avec `--model haiku`, `--tools ""`,
  `--setting-sources ""` (aucun plugin, donc aucun hook OKB), `--no-session-persistence`,
  `--output-format json`, le texte par l'entrée standard. Utilise l'abonnement de la
  personne. Variable `OKB_HEADLESS=1` en plus : les hooks d'OKB ne font rien dans ce
  cas (deuxième sécurité).
- `api` : l'API Messages d'Anthropic par `fetch`, clé dans `ANTHROPIC_API_KEY`
  (jamais écrite dans un fichier d'OKB), modèle `claude-haiku-5-5` par défaut.
- `fake` : pour les tests (`OKB_AI=fake`), réponse déterministe, aucun réseau.
- Réglage global `ai.provider` : `auto` (Claude Code s'il est là, sinon la clé) ·
  `claude-code` · `api` · `off`. Taille de modèle : `small` (traduire) ou `medium`.
- Chaque appel renvoie le texte et les tokens consommés, qui s'ajoutent au
  **budget du jour** (`budget.daily`, partagé avec les cartes).

### Traduction (§3.1)

`src/translate/translate.ts` :

- **Sur un clic seulement**, une langue à la fois ; jamais d'avance.
- La note est découpée en sections (par titres). Restent **tels quels** :
  l'en-tête YAML, les blocs de code et Mermaid, les citations (`>`), les cibles des
  liens, les notes de bas de page. Les termes du glossaire du cerveau sont donnés
  au modèle comme « à garder ou traduire selon le lexique ».
- **Cache sur le disque** : `<état>/translations/<empreinte du chemin>.<langue>.json`,
  une entrée par section, indexée par l'empreinte du texte source. Une note
  modifiée ne retraduit que les sections changées. Une entrée non lue depuis 30
  jours est supprimée.
- **D'abord « En bref »** (`scope: brief`) ; « Traduire toute la note » (`full`)
  ensuite.
- **Coût annoncé avant** : `estimate()` donne les tokens des sections pas encore en
  cache ; refus si le budget du jour est dépassé.
- **Enregistrer comme note** : une proposition crée « <titre> (EN) » à côté de
  l'originale, avec un lien vers elle ; rien n'est écrit sans approbation.
- CLI : `okb translate <note> --to en [--full] [--estimate]`. API :
  `GET /api/translate/estimate`, `POST /api/translate`, `POST /api/translate/save`.

## A5. Des tests solides sous charge

Le test `workspace.test.ts` a dépassé 90 s pendant `release:check` alors qu'il
passe en 18 s seul. On mesure les tests les plus lents et on réduit leur coût
(moins de processus Git, dépôts de test partagés) plutôt que d'allonger les délais.

## Ce qui n'est pas fait ici

- Les pages (Modules, « Utiliser dans Claude Code », bulle, bouton Traduire, barre
  dans la page Repos) : phase B, en React.
- La vérification de licence : seulement l'interface `entitled()`.
- L'examen de connaissance (§5.1) : phase D.

## Tests

Tests d'abord pour chaque moteur : catalogue et droits, identité stable,
inventaire des repos du cerveau sur la démo fictive, calcul du niveau (cas vide,
partiel, complet, obsolète), extraction et validation de la phrase, découpage et
cache de traduction avec le fournisseur `fake`, budget, et les routes API (jeton
exigé pour les POST).
