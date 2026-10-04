# Version 0.3.0

Cette version transforme OKB en deuxième cerveau dont la forme est réglable et
constante : on choisit comment les notes sont écrites (style), comment elles sont
structurées (modèles), et chaque notion importante a sa fiche pédagogique.

## Nouveautés

- **Style de rédaction** (`writing`, `reader`) : trois profils de départ et huit
  réglages, ajustables pour une seule demande ; règles de fiabilité non
  modifiables. `okb style` affiche le brief. Voir [STYLE.md](../dev/STYLE.md).
- **Modèles de notes** : guide, concept, procédure, retour d’expérience, décision,
  réunion. Le CLI impose sections, ordre et titres ; une KB peut les adapter dans
  `.okb/templates/`. `okb template list|show`. Voir [TEMPLATES.md](../dev/TEMPLATES.md).
- **Fiches concepts pédagogiques** : définition en une phrase, analogie et sa
  limite, fonctionnement, exemple, schéma, confusions à éviter, extraits exacts ;
  alias pour que les pluriels et traductions renvoient à la fiche.
- **Dossier d’analyse v2** : plusieurs sources par note, aides pédagogiques
  rattachées aux affirmations qu’elles reformulent, liens « à lire avant » et
  « pour aller plus loin ».
- **Code source comme source** : lignes et symboles cités, rien d’exécuté.
- **Notes liées en une approbation** : `--after` et `okb combine` ; `okb review
  --discard` pour écarter une proposition.
- **Révision de style** : `okb revise` réécrit une note sans toucher citations,
  code, notes de bas de page ni sections.
- **Plugin autonome** : `plugin/bin/okb` met le CLI de la même version sur le PATH
  de Claude ; nouvelle skill `okb-revise`.
- **Entretien** : `okb maintain` signale les notes écrites dans un autre style
  (`STYLE_DIFFERS`) ou qui ont perdu une section de leur modèle
  (`TEMPLATE_DRIFT`), sans rien réécrire.
- **Fraîcheur sur demande** : `okb maintain --check-sources` compare les fichiers
  locaux aux empreintes d’ingestion ; modifié, absent ou inconnu, sans réseau.
- **Lecteur local** : `okb serve` pour notes, recherche et propositions, avec
  aperçu et diff exacts, sans mutation ni approbation dans le navigateur.
- **Capture et revue** : `okb capture` / `okb inbox` (inbox privée hors KB, tri
  vers des propositions), `okb weekly` (revue hebdomadaire en lecture seule, notes
  à relire à J+1, 7, 30, 90), skills `okb-inbox`, `okb-weekly`, `okb-learn`.
- **Aucun secret** : clés, jetons et identifiants refusés dans les propositions et
  captures (`E_SECRET`), recontrôlés à l'application, signalés par `okb maintain`.
- **Fiabilité** : édition concurrente protégée pendant la préparation des écritures,
  liens recontrôlés à la reprise, anciennes approbations inutilisables après discard,
  alias/titre identiques sans fausse ambiguïté et maintenance robuste aux URL invalides.

## Compatibilité

- Les profils 0.2 restent valides ; `writing`, `reader` et `kb.requireTemplate`
  prennent des valeurs par défaut sans effet sur l’existant.
- Les dossiers version 1 sont toujours acceptés et rendus à l’identique.
- Les propositions 0.2 restent applicables ; rien n’est réécrit dans une KB tant
  qu’une nouvelle proposition n’est pas approuvée.
- `generated.by` des nouvelles notes vaut `okb/0.3`.

## Vérification

`npm run release:check` : vérification des types, suite de tests, contrôles du
plugin et installation propre du paquet avec un parcours fictif complet. Les
évaluations natives de Claude restent à lancer dans l’environnement cible.
