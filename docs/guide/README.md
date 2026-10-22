# Guide d’utilisation d’OKB

OKB est un second cerveau local : Claude lit tes sources et rédige, OKB vérifie
les références et citations des affirmations attribuées aux sources, te montre les changements, et n’écrit
dans tes notes qu’après ton accord. Tes notes restent des fichiers Markdown que
tu lis dans Obsidian.
Les explications générales et les inconnus sont distingués ; une citation présente ne garantit pas la vérité du texte.

Tu peux tout faire de trois façons, au choix :

| | Pour qui | Comment |
|---|---|---|
| **Claude** | tu travailles déjà avec Claude Code | parle normalement : « lis ce transcript », « fin de session » ; OKB propose de s’en occuper |
| **Application web** | tu préfères cliquer, lire confortablement | `okb serve` ouvre la page dans ton navigateur |
| **Terminal** | tu aimes les commandes | `okb` tout court ouvre un menu |

## Les pages du guide

**Nouveau en version 1 :**
[ton cerveau et le Zoom](cerveau.md) ·
[rien n'est écrit sans ton oui](demander-avant-ecrire.md) ·
[retrouver en trois secondes](retrouver.md) ·
[le module développeur](module-developpeur.md) ·
[apprendre et la carrière](apprendre-et-carriere.md) ·
[stockage et confidentialité](stockage-et-confidentialite.md).

**Nouveau en 1.5 :** [modules, niveau de connaissance et examen d’un repo, phrase des concepts, traduction et partage](modules-et-niveau.md) · [l’application web](application-web.md).

**Nouveau en 2.0 :** [projets, actions et journal : garder le fil](projets.md) · [les documents : garder un fichier tel quel](documents.md) · [deux espaces : Mon bagage et Travail](espaces.md) · [passer de la 1.5 à la 2.0](passer-a-la-2-0.md) · [brancher un assistant du terminal (MCP)](assistants-mcp.md).

**Préparation des étapes suivantes :** [partager à deux](partager-a-deux.md) ·
[comprendre et apprendre](comprendre.md) · [l’application desktop](application-desktop.md) ·
[l’assistant local](assistant-local.md) · [export complet et restauration](export-et-restauration.md).
[Le suivi d’un ticket](reprendre-un-ticket.md) détaille la préparation 2.4.
[Valider les notes en un geste](valider-les-notes.md) : l’agent range, tu relis au calme.
[Les gros transcripts](transcripts-longs.md) distinguent une question ciblée
d’un compte rendu couvrant toutes les fenêtres, avec leurs corrections.
Ces guides décrivent le code de développement ; la publication et les essais
d’usage réel suivent les portes de la feuille de route.

1. [Installer OKB](installer.md) — en 5 minutes, sans toucher à tes réglages Claude.
2. [Au quotidien](au-quotidien.md) — capturer, importer une source, relire,
   finir une session, revue de la semaine.
3. [Une KB pour chaque repo de code](repos.md) — être onboardé sur un repo inconnu,
   puis enrichir sa KB après chaque ticket.
4. [Plusieurs repos : l'espace de travail](espace-de-travail.md) — une KB pour les
   repos d'une équipe, OKB qui se concentre sur le repo et le ticket en cours.
   [Choisir son organisation](choisir-son-organisation.md) : KB de sujet, de repo
   ou espace de travail, et la marche à suivre pour un premier ticket.
5. [L’application web](application-web.md) — tout ce que fait le terminal, en clics.
6. [Le graphe et les catégories](graphe-et-categories.md) — voir toutes tes notes
   et leurs liens, une couleur par type de note, et à quoi sert encore Obsidian.
7. [Utilisation, coûts et rapport](utilisation-et-couts.md) — ce que coûte OKB,
   si son travail te convient, et le rapport qui sert à l’améliorer.
8. [Réglages](reglages.md) — langues, style d’écriture, plusieurs KB, cohabitation
   avec d’autres outils.
9. [Dépannage](depannage.md) — comprendre une erreur et la corriger.

Les documents techniques (architecture, décisions, sécurité) sont dans
[docs/dev](../dev/).

## Trois idées à retenir

- **Rien n’entre dans ta KB sans ton accord.** Claude prépare une *proposition* ;
  toi seul l’approuves. Chaque changement appliqué peut être annulé (`okb undo`).
- **Une KB = un dossier, sur ton ordinateur.** Un sujet, un repo de code ou les
  repos d'une équipe. Tu peux en avoir plusieurs ; OKB n’écrit jamais dans le
  dossier d’un autre outil, et ne met jamais une KB sous Git.
- **Ta mémoire entre deux sessions.** Une courte note de *focus* (ce sur quoi tu
  travailles) et un *journal* des sessions permettent à Claude de reprendre là où
  tu t’étais arrêté.
