# Modules, niveau de connaissance et traduction

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
- Les lignes `+N pts` disent quoi faire d'abord.

## La phrase courte des concepts

Au survol d'un mot qui a une fiche, l'application montre **une seule phrase** : celle
de la section « En une phrase » de la fiche (3 à 25 mots). Sans elle, le mot reste
un simple lien.

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
- Une note 🔒 n'est envoyée à l'IA qu'après ta confirmation (`--confirm-secret`) ;
  une note qui contient un secret, jamais.
- L'IA utilisée : Claude Code s'il est installé, sinon ta clé
  `ANTHROPIC_API_KEY` (réglage `ai.provider` : `auto`, `claude-code`, `api`, `off`).
