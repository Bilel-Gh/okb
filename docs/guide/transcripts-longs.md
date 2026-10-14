# Une question ou le compte rendu de toute une réunion

Une recherche ciblée et un compte rendu complet ont des portées différentes.
OKB conserve les timecodes, les locuteurs fournis par le fichier et un snapshot
de l’extraction. Il ne retranscrit pas l’audio et n’invente pas le sens des sigles.

Pour retrouver une information, sans IA :

```sh
okb ingest reunion.vtt --extract-only --query "retention" --json
```

La recherche porte sur tous les blocs, renvoie les passages voisins et signale
les corrections possibles. Les citations restent exactes. Une absence de
résultat peut demander d’autres mots ; elle ne prouve pas une absence dans la
réunion. Les résultats indiquent leur pagination et ne déclarent jamais une
couverture complète.

Pour un compte rendu, l’agent lit toutes les fenêtres bornées avec
`--extract-only`, conserve leurs résultats avec `--window-result`, puis consulte
`--coverage` et toutes les pages de `--meeting-report`. Le
[protocole des fenêtres](../../plugin/skills/okb-ingest/references/meeting-windows.md)
décrit le format. Les blocs délivrés et ceux dont l’analyse est déclarée sont
comptés séparément. Les plages restantes et les limites d’extraction sont
visibles. Ces compteurs ne certifient pas la compréhension du modèle.

Les décisions, actions explicites, suggestions, questions et incertitudes
restent distinctes. Une correction tardive peut remplacer un fait antérieur
tout en gardant les deux passages. Les contradictions non résolues sont
présentées au lecteur. Le dossier final suit les propositions habituelles :
rien n’est écrit dans les notes sans votre approbation.

Les essais locaux n’appellent aucun modèle. Les budgets en tokens sont des
estimations à partir des octets, pas une facture ni une économie garantie.
