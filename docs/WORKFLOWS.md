# Workflows concrets

## Import complet

1. `okb ingest /chemin/source.vtt --extract-only --json` fournit un `runId` et une page.
2. Lire la suite avec le même `--run` et `--cursor`. Les blocs trop longs sont
   fractionnés ; chaque fragment conserve son localisateur. Lire jusqu’au bout.
3. `okb ask "sujet" --limit 5 --json` cherche une destination existante.
4. `okb ingest /chemin/source.vtt --run <runId> --template --json` crée un modèle
   de dossier dans l’état privé. Claude le remplit selon
   [le contrat d’analyse](../plugin/skills/okb-ingest/references/analysis-dossier.md).
5. Préparer, sans modifier la KB :

```bash
okb ingest /chemin/source.vtt --run <runId> --analysis-file /chemin/prive/dossier.json \
  --append flows/executer-un-job.md --heading "Exceptions et décisions" --json
```

6. `okb review <id> --diff --json`, puis revue indépendante par le sous-agent de
   preuves. Lire les pages supplémentaires si nécessaire. Le dossier complet
   et le snapshot sont dans l’état, pas dans le contexte permanent de Claude.
7. Une personne signe `okb review <id> --approve --only c-article,c-concept-0` pour
   la sélection qu’elle vient de lire ; l’agent applique exactement cette sélection
   avec `okb apply <id> --json`.

Le dossier impose une preuve par affirmation et refuse les citations inventées
ou une couverture incomplète déclarée. Cela ne garantit pas qu’un extrait soutient
logiquement l’affirmation. Le réviseur cherche les négations et corrections tardives.
Le résumé privé n’est pas publié comme prose non sourcée.

Sans dossier, le noyau peut préparer un aperçu brut explicitement partiel pour
inspection. Il ne constitue pas un enrichissement intelligent terminé. La skill
normale utilise toujours le dossier. Une source sans contenu lisible ne produit
pas de proposition.

## Concepts et refus partiels

Les nouvelles définitions demandent des extraits source. Les acronymes inconnus
sont des candidats à clarifier et ne créent pas de fichiers vides. Les définitions
existantes et alias sont réutilisés ; un domaine peut désambiguïser un terme.

Le texte rédigé de l’article reçoit des liens par section. Les extraits bruts,
le code, les citations et les liens existants sont protégés. Chaque insertion est
un changement distinct : refuser une fiche enlève ses insertions sans effacer
les liens vers les autres concepts. Refuser un article neuf enlève les insertions
qui dépendent de sa création. Les migrations de fichiers sont indivisibles.

Un import identique dans la même cible est un no-op fondé sur le hash source,
même si la prose générée varie. `--reprocess` sert à une reprise volontaire et peut
proposer un nouvel ajout ; inspecter le diff pour éviter des sections redondantes.
Une nouvelle révision de source est différente et doit conserver la visibilité
des divergences avec la KB existante.

## Lire et entretenir

`okb ask "question" --json` retourne des passages, chemins, lignes réelles,
statuts et niveaux de confiance. Claude formule la réponse avec ces références.
S’il ne trouve pas, il reformule/recherche puis indique la limite ; il ne complète
pas la KB à partir de sa propre réponse.

`okb maintain`, `okb links check` auditent. `okb nav`, `okb links move` et
`okb migrate portable-links` retournent des identifiants de propositions. Un index
personnalisé peut être remplacé par la navigation générée : cette perte potentielle
est visible dans le diff et l’ancienne version reste dans la sauvegarde après apply.

## Reprendre ou annuler

`okb apply <id> --resume` reprend uniquement le même contenu et la même sélection.
`okb apply --rollback rcpt-<id>` annule aussi une application interrompue, grâce au
reçu écrit avant la première mutation. Si un humain a modifié un fichier depuis,
l’annulation s’arrête avant d’écraser ce travail. Après rollback, recréer une
proposition : l’ancienne autorisation est supprimée.
