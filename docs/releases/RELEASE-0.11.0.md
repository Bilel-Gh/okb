# Version 0.11.0

Cette version rend la mise en place d'OKB **guidée** : une phrase suffit.

- **« Configure OKB pour moi »** dans Claude Code (ou `/okb:setup`, `/okb:start`).
  Le skill d'installation commence par regarder ta situation, sans IA et sans
  rien écrire :
  - tes KB et leurs types ;
  - le dossier de repos autour de toi, jusqu'à deux niveaux, dossier par
    dossier ;
  - une ancienne KB écrite avant OKB ;
  - l'état du plugin.

  Il recommande une organisation avec sa raison, pose seulement les questions
  utiles (le nom de la KB n'est jamais deviné), te montre l'aperçu du plan,
  puis le lance après ton accord.
- **`okb start`** fait la même chose dans un terminal : aperçu, recommandations,
  plan de commandes exactes, exécution après confirmation. `--json` sert au skill.
- **Un espace complet.** Si un espace de travail existe déjà, OKB vérifie que
  tous les repos du dossier y sont et propose d'ajouter ceux qui manquent.
  Des repos rangés en plusieurs groupes (par équipe) sont signalés : un espace,
  ou un espace par groupe.
- **Une ancienne KB n'est plus prise pour un repo** :
  - Claude ouvert dans son dossier propose `/okb:convert`, plus `/okb:onboard` ;
  - `okb workspace add` la laisse de côté et dit comment la connecter.
- `okb convert` est un raccourci de `okb kb convert`.
- Décision : D35.

Vérification : `npm run release:check`. Nouveaux tests :
- un dossier de travail avec trois repos et une ancienne KB sous Git, de
  l'analyse au plan exécuté ;
- un repo seul ;
- un dossier sans code ;
- un espace auquel il manque des repos, avec des groupes par équipe ;
- les phrases qui lancent l'installation guidée ;
- une ancienne KB à côté des repos.
