# Guide d’utilisation d’OKB

OKB est un second cerveau local : Claude lit tes sources et rédige, OKB vérifie
chaque phrase contre une citation exacte, te montre les changements, et n’écrit
dans tes notes qu’après ton accord. Tes notes restent des fichiers Markdown que
tu lis dans Obsidian.

Tu peux tout faire de trois façons, au choix :

| | Pour qui | Comment |
|---|---|---|
| **Claude** | tu travailles déjà avec Claude Code | parle normalement : « lis ce transcript », « fin de session » ; OKB propose de s’en occuper |
| **Application web** | tu préfères cliquer, lire confortablement | `okb serve` ouvre la page dans ton navigateur |
| **Terminal** | tu aimes les commandes | `okb` tout court ouvre un menu |

## Les pages du guide

1. [Installer OKB](installer.md) — en 5 minutes, sans toucher à tes réglages Claude.
2. [Au quotidien](au-quotidien.md) — capturer, importer une source, relire,
   finir une session, revue de la semaine.
3. [Une KB pour chaque repo de code](repos.md) — être onboardé sur un repo inconnu,
   puis enrichir sa KB après chaque ticket.
4. [L’application web](application-web.md) — tout ce que fait le terminal, en clics.
5. [Réglages](reglages.md) — langues, style d’écriture, plusieurs KB, cohabitation
   avec d’autres outils.
6. [Dépannage](depannage.md) — comprendre une erreur et la corriger.

Les documents techniques (architecture, décisions, sécurité) sont dans
[docs/dev](../dev/).

## Trois idées à retenir

- **Rien n’entre dans ta KB sans ton accord.** Claude prépare une *proposition* ;
  toi seul l’approuves. Chaque changement appliqué peut être annulé (`okb undo`).
- **Une KB = un dossier.** Un sujet (IA, Finance) ou un projet. Tu peux en avoir
  plusieurs ; OKB n’écrit jamais dans le dossier d’un autre outil.
- **Ta mémoire entre deux sessions.** Une courte note de *focus* (ce sur quoi tu
  travailles) et un *journal* des sessions permettent à Claude de reprendre là où
  tu t’étais arrêté.
