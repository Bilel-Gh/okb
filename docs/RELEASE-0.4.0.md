# Version 0.4.0

Cette version donne à OKB une mémoire entre les sessions et le relie à la façon
dont on travaille vraiment : ce sur quoi on se concentre, ce qu'on a fait, les
process qui reviennent et les KB versionnées avec Git.

## Nouveautés

- **Note de focus** (`okb focus init|set`, `/okb:focus`) : 3 à 8 lignes sur ce que
  tu fais, ce que tu veux apprendre et la prochaine échéance. Hors de la KB, avec
  son mode d'emploi intégré ; la version précédente est gardée à chaque mise à jour.
- **Fin de session** (`okb done`, `/okb:done`) : une entrée dans le journal des
  sessions (résumé, fait, décidé, prochaine fois) et une capture d'inbox par
  connaissance à garder. Rien n'entre dans la KB sans proposition approuvée.
- **Reprise automatique** : un hook `SessionStart` du plugin donne à Claude la note
  de focus et la dernière « prochaine fois » ; il se tait sans focus ni journal.
- **Revue hebdomadaire** : signale un focus trop ancien et liste les sessions de
  la semaine avec leurs suites.
- **`okb skillify`** et `/okb:skillify` : d'une note procédure, process ou
  automatisation à un brouillon de skill Claude Code, relu avec toi puis testé.
- **Trois modèles de notes** : `process` (livrable, fréquence, priorité temps /
  pénibilité / impact, part de l'IA), `tool`, `automation`. Neuf modèles en tout.
- **Commit Git par application** : `git.autoCommit: true` committe exactement les
  fichiers de chaque application ou annulation ; rien n'est poussé.
- **Configuration guidée** : `okb-setup` pose une question à la fois et recommande
  une convention de nommage (dossier `kb-<nom>`, profil `<nom>`, dépôt `kb-<nom>`).
- **Dossiers cachés ignorés** : `.github/README.md` et autres outils ne sont plus
  lus comme des notes.
- **Catalogue du plugin** renommé `okb` : `claude plugin install okb@okb`.
- `generated.by` des nouvelles notes vaut `okb/0.4`.

## Mise à jour depuis 0.3.0

Les profils existants restent valides : les nouvelles clés `focus` et
`git.autoCommit` ont des valeurs par défaut. Réinstalle le plugin pour charger les
nouvelles skills et le hook :

```bash
claude plugin uninstall okb@okb-local
claude plugin marketplace remove okb-local
claude plugin marketplace add /chemin/du/produit
claude plugin install okb@okb
```

Voir [DECISIONS.md](DECISIONS.md), D16 à D20.
