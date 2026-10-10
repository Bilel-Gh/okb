# Modules, niveau, examen, traduction et partage

> Nouveau après la 1.0. Les pages de l'application arrivent avec la refonte ; tout
> marche déjà dans le terminal et par Claude.

## Les modules

OKB a un **cœur** (ton cerveau, la recherche, les cartes, apprendre, la carrière,
les sauvegardes) et un **module par métier** :

| Module | Pour qui | Statut |
|---|---|---|
| 🧠 Le cœur | tout le monde | toujours actif |
| 💻 Développeur | développeurs : produits, repos, tickets | disponible |
| 🛠️ DevOps | runbooks, incidents, infrastructure | bientôt |
| 🤝 Commercial | clients, comptes, offres | bientôt |

```bash
okb modules
```

- `okb modules off dev` masque les pages et commandes du module ; tes notes ne
  bougent pas. `okb modules on dev` les remet.
- `okb modules install dev` ajoute le module à Claude Code (puis redémarre
  Claude Code).

## Ton identifiant

```bash
okb whoami
okb settings set person.role dev
```

OKB te donne un identifiant **aléatoire** (`p-…`), jamais ton nom. Il signe tes
approbations et tes décisions, pour le jour où ton équipe partagera ses cerveaux.

## Le niveau de connaissance d'un repo

```bash
okb repo level
```

```
📦 atlas-api  ███████████████░░░░░ 74 % · Solide
   +3 pts · écrire « Architecture du repo »
```

Calculé sans IA, sur 100 :

| Part | Points | Ce qui compte |
|---|---|---|
| Questions d'onboarding | 30 | les questions répondues par une note |
| Pages du repo | 25 | Démarrer, Architecture, Interfaces, Livrer, Carte du code, Tester, Déboguer… à jour |
| Code lu | 20 | les fichiers clés lus et cités |
| Mémoire du travail | 15 | tickets, pièges, erreurs connues gardés |
| Qualité | 10 | la note moyenne des notes du repo |

- **La connaissance vieillit** : quand le code qu'une page cite change, elle compte
  moins ; quand il disparaît, encore moins.
- **Un repo dont le code n'est pas relié** à cet ordinateur (un cerveau reçu, la
  démo) est mesuré sur ses notes, et ne dépasse pas « Solide ». Relie-le :
  `okb repo add <dossier> --product <produit>`.
- Les lignes `+N pts` disent quoi faire d'abord (en points de ce niveau, même
  quand il est mesuré sur les notes seulement).

## L'examen de connaissance d'un repo

Le niveau dit ce que le cerveau contient ; l'examen vérifie qu'une IA **y trouve les
bonnes réponses**. Claude répond aux 25 questions d'onboarding, et à celles de ton
équipe, **avec les notes du repo seulement** ; puis chaque réponse est notée contre
une référence que les notes n'ont pas écrite :

- la **réponse attendue** d'une question de l'équipe ;
- la **réponse d'une personne** enregistrée (`okb repo answer`) ;
- les **lignes de code** que l'analyse du repo désigne pour la question.

```bash
okb repo exam atlas-api                     # ce qui sera demandé, et le coût
okb repo exam atlas-api --yes               # passer l'examen
okb repo exam atlas-api --last              # le dernier résultat
okb repo exam atlas-api --add "Quelle base de données ?" --expect "PostgreSQL 16"
```

```
📝 atlas-api  84 %  21 justes · 2 à moitié · 2 fausses · 4 sans note · 2026-10-09
  ✗ Comment le lancer en local ?  — les notes n'en parlent pas
  ◐ Que vérifie la CI ?  — il manque l'étape de sécurité
  · Sans note : rien pour vérifier (4)
```

- Une réponse **juste** compte 1, **à moitié** 0,5 ; le score ne porte que sur les
  questions vérifiables. Sans référence, une question est répondue mais pas notée.
- Le coût est annoncé avant (il compte dans le **budget du jour**) ; une note 🔒 ou
  un passage qui contient un secret ne part jamais, le code non plus s'il en
  contient un.
- Les dix derniers résultats sont gardés : la fiche du repo montre le score, son
  évolution, chaque réponse avec ce qui l'a vérifiée et les notes d'où elle vient.

## La phrase courte des concepts

Au survol d'un mot qui a une fiche — écrit dans le texte ou déjà lié à la fiche —
l'application montre **une seule phrase** : celle de la section « En une phrase » de
la fiche (3 à 25 mots, les abréviations comme « p. ex. » ne la coupent pas). Sans
elle, le mot reste un simple lien.

```bash
okb concepts check            # les fiches sans phrase valide
okb concepts check --suggest  # une carte « compléter » pour chacune
```

## Traduire une note

```bash
okb translate "Livrer une version" --to en             # « En bref » d'abord
okb translate "Livrer une version" --to en --estimate  # le coût, sans rien dépenser
okb translate "Livrer une version" --to en --full      # toute la note
okb translate "Livrer une version" --to en --save      # en faire une note (proposition)
```

- **Rien n'est traduit d'avance.** Une traduction est gardée sur ton ordinateur :
  la relire ne coûte rien ; si la note change, seules les sections modifiées sont
  retraduites. Oubliée après 30 jours sans lecture.
- Le code, les schémas, les citations et les liens restent tels quels.
- Le coût compte dans le **budget du jour** (`budget.daily`), avec les cartes.
- Une note 🔒 n'est envoyée à l'IA qu'après ta confirmation (`--confirm-secret`),
  valable pour son contenu du moment ; une note qui contient un secret, jamais. Les
  termes de tes fiches 🔒 ne partent pas non plus avec la traduction d'une autre
  note.
- « Enregistrer comme note » n'apparaît qu'une fois la note entière traduite.
- La langue de départ est celle de la note (déclarée par `lang`, sinon devinée à
  ses mots), pas forcément celle du profil.
- L'IA utilisée : Claude Code s'il est installé, sinon ta clé
  `ANTHROPIC_API_KEY` (réglage `ai.provider` : `auto`, `claude-code`, `api`, `off`).
  En `auto`, si Claude Code échoue (session expirée), la clé prend le relais.
- Les appels d'OKB à l'IA passent un par un : deux clics en même temps ne
  dépassent pas le budget du jour.

## Ta progression

```bash
okb progress
```

Lire, réviser, trancher une carte, écrire une note : chaque geste rapporte un peu
d'expérience, un peu moins quand il se répète le même jour. Des badges bronze,
argent et or (lecteur, réviseur, décideur, bâtisseur, régulier). Tout reste sur ton
ordinateur ; pour ne plus la voir : `okb settings set progress.show false`.

## Partager avec un collègue, sans serveur

```bash
okb pack export "2 Produits/Atlas/Code/atlas-api" --out atlas-api.okbpack.json
okb pack compare atlas-api.okbpack.json --into "2 Produits/Atlas/Code/atlas-api"
okb pack merge atlas-api.okbpack.json --into "2 Produits/Atlas/Code/atlas-api"
```

- Le pack contient les notes du sujet et qui les a écrites ; jamais une note 🔒,
  privée, ou qui contient un secret.
- `compare` dit ce que le pack apporte : notes en plus, différentes, identiques.
- `merge` prépare une proposition qui ajoute ce qui te manque, avec l'auteur
  d'origine ; une note différente n'est jamais écrasée.
- Dans l'application : **Outils › Partager**. Choisis un dossier et télécharge son
  pack ; ou dépose le pack d'un collègue : tu vois ce qui te manque, ce qui diffère
  (l'écart ligne à ligne) et ce qui est identique, puis tu proposes les notes
  manquantes en un clic.
