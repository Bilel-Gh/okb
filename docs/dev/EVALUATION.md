# Vérifier le système et le comportement du modèle

## Noyau déterministe

`npm run release:check` contrôle les types, exécute les tests, inspecte les composants
Claude et installe le paquet npm dans un environnement temporaire avec un nouveau
profil. Il teste l’extraction paginée, un dossier d’analyse, les diffs, l’approbation,
les liens et le rollback sur des données fictives. Les régressions portent notamment
sur les politiques, les chemins, les symlinks, les modifications concurrentes et
les interruptions après écriture mais avant journalisation.

`claude plugin validate ./plugin` est le contrôle officiel du manifest. Il ne
prouve pas la sélection des skills ni la qualité de synthèse.

## Évaluations natives de Claude

Le dossier `plugin/evals/` contient dix cas de déclenchement positifs/négatifs (dont `revise-fr`, ajouté avec le style configurable)
et un cas sémantique de correction tardive/acronyme inconnu. Les cas utilisent
uniquement Read, Glob, Grep et Skill ; ils ne touchent pas une vraie KB. Les graders
`tool_used` examinent les invocations réelles de Skill, pas le sélecteur lexical
`okb route`. Le cas sémantique a des critères explicites et un juge modèle.

Avec une version compatible et ton compte habituel :

```bash
claude plugin eval ./plugin --case ingest-fr --runs 1 --ablation none --no-publish
claude plugin eval ./plugin --runs 3 --no-publish
```

La première exécution demande la confiance dans le dossier. Les appels utilisent
les quotas/facturation du compte ; aucun résultat de ces évaluations n’est prétendu
mesuré dans la livraison s’ils n’ont pas été exécutés. Conserver les rapports
localement avec `--no-publish`. La commande eval requiert Claude Code 2.1.269+
selon la documentation consultée ; sa disponibilité dépend aussi du service.

[Documentation des évaluations](https://code.claude.com/docs/en/plugin-evals)
· [Manifest et validation](https://code.claude.com/docs/en/plugins-reference)
· [Skills](https://code.claude.com/docs/en/skills).

## Acceptation dans ton environnement

Sur une **copie du corpus fictif**, charger le plugin et relever :

- skill effectivement invoquée sur une demande naturelle d’import et une demande
  de simple résumé sans sauvegarde ;
- lecture de la fin du VTT et adoption de la correction de « pipeline » en « broker » ;
- absence de définition inventée pour ZQT, citations exactes et provenance visible ;
- aucune écriture KB avant approbation ; résultat correct après refus d’une fiche ;
- même texte après rollback, langue du profil respectée, profil d’un second utilisateur isolé ;
- contexte réellement rapporté par `/context`, avec les MCP normalement actifs.

Répéter sur quelques exemples représentatifs de ton activité avant diffusion à
l’équipe. Mesurer le temps économisé, le temps de revue, les affirmations non
étayées et les informations utiles oubliées. Ce sont les critères d’utilité ; le
nombre de fichiers générés ou de tests unitaires ne mesure pas cette qualité.

Les fixtures logicielles restent fictives. Un corpus métier privé, ses évaluations
et résultats doivent rester hors du dépôt générique.
