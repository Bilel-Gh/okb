# Choisir son organisation

OKB connaît trois types de KB. Le bon choix dépend de ce que tu documentes.

## Les trois types

| Type | Pour quoi | Organisation des notes |
|---|---|---|
| 📚 **KB de sujet** | un thème sans code : un cours, un domaine, un projet perso | par catégorie : `concepts/`, `guides/`, `procedures/`… |
| 📦 **KB de repo** | un seul repo de code | la KB est ce repo : ses notes à la racine (`comprendre.md`, `architecture.md`…), `tickets/`, `concepts/` |
| 🗂️ **Espace de travail** | les repos d'une équipe | un espace par repo (`repos/<repo>/`) et une partie commune : métier, fonctionnalités qui traversent plusieurs repos, décisions, liens entre repos |

## Laquelle choisir

```text
Des repos de code ?
├─ non                                         → 📚 KB de sujet
├─ plusieurs repos d'une même équipe           → 🗂️ espace de travail (même si tu n'en touches qu'un aujourd'hui)
├─ un repo isolé (projet perso, open source…)  → 📦 KB de repo
└─ deux employeurs ou deux clients             → une KB chacun, jamais mélangés
```

OKB te conseille au moment du choix :
- **`okb new`** demande d'abord à quoi va servir la KB ;
- **`okb repo add`** dans un repo :
  - si d'autres repos sont à côté, il propose de faire du dossier parent un espace de travail ;
  - si le repo est seul, il propose une KB pour lui seul ;
  - si le repo est dans un espace existant, il rejoint sa KB sans question ;
- **`okb workspace add`** sur un dossier qui ne contient qu'un repo propose plutôt une KB de repo.

## Organiser ses dossiers

```text
~/dev/mon-equipe/            l'espace de travail : un dossier par équipe ou employeur
  repo1/
  repo2/
  outils/repo3/              un niveau de sous-dossier est permis
~/Documents/kb-mon-equipe/   la KB, de préférence hors du dossier des repos
```

Une KB rangée dans le dossier des repos n'est jamais prise pour un repo. Une KB de
repo peut aussi vivre **dans son repo**, dans un dossier `.okb-kb` que Git ignore
sur ton ordinateur seulement : rien ne change pour l'équipe.

## Cas concret : rien n'est installé, j'ai un ticket

Ton dossier `~/dev/mon-equipe` contient `repo1`, `repo2`, `repo3` et une ancienne KB
écrite avant OKB. Ton ticket concerne `repo2`. Dans l'ordre :

1. **Connecter l'ancienne KB** (« KB confidentielle » : oui) :
   ```bash
   okb kb add ~/dev/mon-equipe/ancienne-kb
   ```
2. **Créer l'espace de travail dans cette KB** :
   ```bash
   okb workspace add ~/dev/mon-equipe --kb <id de la KB>
   ```
3. **Convertir l'ancienne KB**, dans Claude Code ouvert dans `~/dev/mon-equipe` :
   tape `/okb:convert`, relis, approuve. Les notes qui parlent surtout de `repo2`
   vont dans son espace. Cette étape peut attendre, mais toujours après l'étape 2.
4. **Ouvrir Claude Code dans `~/dev/mon-equipe/repo2`** :
   - la première fois, `/okb:onboard` (Claude lit le code et prépare ses notes) ;
   - crée une branche qui contient la référence du ticket (`feature/ABC-123-…`) ;
   - dis « je commence le ticket ABC-123 » et colle son texte.
5. **Travailler normalement.** Claude note les décisions et les pièges dans le
   journal du ticket.
6. **À la fin**, dis « j'ai fini mon ticket » : tu relis la proposition et tu
   approuves.

Pas d'ancienne KB ? Remplace les étapes 1 à 3 par `okb workspace add ~/dev/mon-equipe` :
OKB crée la KB de travail et te demande son nom.

## Travailler sur un ticket : où ouvrir Claude Code

- **Un ticket sur un repo** : ouvre Claude Code **dans le dossier de ce repo**.
  Claude lit le bon code, Git agit dans le bon repo, et OKB se met sur ce repo
  sans rien demander. Le résumé de départ contient aussi les notes communes et les
  repos voisins : tu ne perds rien de l'espace.
- **Un ticket sur plusieurs repos** (le front et l'API) : ouvre Claude Code **à la
  racine de l'espace** et nomme le ticket. OKB le suit dans chaque repo où tu crées
  sa branche.
- **Une question transverse** (« comment repo1 appelle repo2 ? ») : à la racine aussi.

## Un repo avec sa propre KB dans un espace

Un repo plus confidentiel, ou déjà documenté seul avant l'espace, peut garder sa
KB de repo :
- **rattaché** : ses notes restent dans sa KB, et l'espace lui fournit la partie
  commune.
  - Le résumé de départ et la recherche lisent les deux KB, la sienne d'abord.
  - À la fin d'un ticket, ce qui concerne toute l'équipe va dans la KB de l'espace.
  - Un repo rangé dans le dossier de l'espace est rattaché tout seul ; ailleurs,
    utilise `okb workspace attach <repo>`.
- **fusionné** : `okb kb merge <KB du repo> --into <KB de l'espace>` prépare une
  proposition qui range toutes ses notes dans `repos/<repo>/`.
  - Une fois la proposition approuvée, relance la commande : elle déplace le suivi
    du repo et ses tickets, puis te propose de retirer l'ancienne KB.
  - Son dossier reste intact.

## Le graphe d'un espace de travail

Dans l'application web, la page **Graphe** d'un espace a deux vues :
- **Vue d'ensemble** :
  - une bulle par repo, sa taille suivant son nombre de notes ;
  - une bulle par dossier commun ;
  - des flèches pour les appels entre repos (d'après le code) et pour les liens
    entre notes ;
  - le repo du périmètre est entouré ;
  - un clic sur une bulle ouvre ses notes.
- **Notes** : le graphe habituel, avec un choix « Périmètre ». Il met en avant un
  repo, les notes communes qui le concernent et les repos voisins.

Les tickets ont leur propre catégorie (🎫), avec leur couleur.

## Où sont tes données

| Quoi | Où |
|---|---|
| Tes notes | le dossier de chaque KB, sur ton ordinateur |
| Réglages, liste des KB, des repos et des espaces | `~/.okb/` |
| Propositions, sauvegardes pour annuler, tickets suivis | `~/.okb/profiles/<kb>/state/` |
| Le produit OKB | son propre dossier : du code, aucune donnée à toi |

**OKB ne met jamais une KB sous Git** : il ne fait aucun commit et n'ajoute
aucun remote. L'annulation (`okb undo`) repose sur ses propres sauvegardes. Si tu
veux un historique ou une copie ailleurs, c'est toi qui t'en occupes.
