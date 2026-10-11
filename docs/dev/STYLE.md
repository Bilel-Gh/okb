# Style de rédaction, niveau du lecteur et aide aux concepts

La structure des notes (quelles sections, dans quel ordre) relève des
[modèles](TEMPLATES.md) ; ce document traite de la manière d’écrire.

Quatre réglages distincts décident de la forme d’un article. Les mélanger rend
le système imprévisible ; ils restent donc séparés.

| Réglage | Question à laquelle il répond | Où | Modifiable par |
|---|---|---|---|
| Style (`writing`) | Comment écrire : langue, détail, ton, exemples, analogies, schémas, émojis, progression, définitions | profil, `.okb/kb.yaml`, org/équipe | préférence, demande ponctuelle |
| Lecteur (`reader`) | Que sait déjà le lecteur, au global ou par domaine | profil | préférence, `--reader` ponctuel |
| Aide aux concepts (`conceptAssist`) | Faut-il proposer des fiches et des liens vers des notions | profil, par domaine | préférence, `--concept-assist` ponctuel |
| Règles communes | Fiabilité, sources, citations, confidentialité | code du produit (`src/style/brief.ts`) | personne |

## Profils de départ

`okb style presets` liste trois points de départ. Un profil choisit un preset et
ne déclare que ce qui diffère.

| Réglage | `standard` | `pedagogique` | `expert` |
|---|---|---|---|
| `detail` | standard | essential | thorough |
| `tone` | neutral | warm | neutral |
| `examples` | generic | project | none |
| `analogies` | off | when-useful | off |
| `diagrams` | when-useful | when-useful | when-useful |
| `emojis` | off | landmarks | off |
| `progression` | usage-first | usage-first | reference |
| `defineTerms` | inline | inline | off |

`language` vaut par défaut `profile.answer.language`. `instructions` accepte
jusqu’à huit consignes libres et courtes. `profile.answer.style` est un ancien
champ conservé pour la compatibilité ; il n’est lu par rien.

```yaml
# ~/.okb/profiles/<id>/profile.yaml (extrait)
writing:
  preset: pedagogique
  instructions:
    - Ton jamais infantilisant.
reader:
  level: intermediate
  byDomain:
    ia-agentique: beginner
```

## Ordre de résolution

Preset → couches de configuration (defaults → org → équipe → profil → KB-locale →
environnement → options) → type de note → demande ponctuelle. Le type de note
(`okb style --type concept`) apporte sa longueur : le défaut du produit
(`src/style/simple.ts` : une fiche « une minute » est courte, un guide détaillé,
une décision courte avec son pourquoi, un compte rendu normal), puis le choix de
la personne (`writing.byType`). Les mots simples nomment l'existant : style
technique, normal, simplifié = presets `expert`, `standard`, `pedagogique` ;
longueur courte, normale, détaillée = `detail` `essential`, `standard`, `thorough` (D61). Une KB peut déclarer un style
maison dans `.okb/kb.yaml` ; il l’emporte sur le profil pour les articles de cette
KB. Le style n’est pas une politique : une organisation peut proposer un défaut,
pas l’imposer techniquement.

## Chargement sans gonfler le contexte

Le style n’est ni dans `CLAUDE.md`, ni dans un *output style* : ces mécanismes
sont envoyés à chaque requête de la session et s’appliqueraient aussi à des
tâches sans rapport. `okb style --json` produit un brief d’environ 2 Ko, lu
seulement par les workflows qui écrivent (`okb-ingest`, `okb-garden`, et
`okb-ask` lorsqu’une explication est demandée). Il remplace dans l’import la
lecture de la configuration complète.

## Ajuster une seule demande

```bash
okb style --set detail=thorough --set emojis=off      # un réglage
okb style --preset expert                               # autre point de départ
okb style --reader beginner --note "Compare avec SQL"   # lecteur et consigne libre
```

Rien n’est enregistré (`persisted: false`). Un `--preset` ponctuel repart du
preset choisi : les surcharges du profil ne s’y mélangent pas, sauf la langue
et les consignes libres. Le style effectivement utilisé est copié dans le
dossier d’analyse v2 (`style`), donc dans la proposition signée ; la proposition
signale un style différent de celui du profil.

## Ce que le noyau contrôle

- Le dossier v2 sépare **affirmations** (faits sourcés, extraits verbatim) et
  **aides** (`explanation`, `analogy`, `diagram`, `example`) reliées par
  `basedOn` aux affirmations qu’elles reformulent.
- Une analogie sans `limits` est refusée. Une analogie, un schéma ou une aide
  `example` est refusé si le style enregistré les désactive. Un schéma doit
  être du Mermaid nu. Le nombre de nœuds reste une consigne pour l’auteur.
- Les libellés fixes (avertissement, « Analogie », « Questions ouvertes »…)
  suivent la langue du style ; les émojis repères ne s’ajoutent qu’à ces libellés.
- Le contrôle ne juge ni la pertinence d’une analogie ni l’absence de fait
  ajouté : c’est le rôle du réviseur de preuves et de la personne qui approuve.

## Changer de style sans réécrire la KB

Un nouveau style s’applique aux nouveaux contenus. Les notes créées portent
`x_okb.writing` ; `okb maintain` liste en `STYLE_DIFFERS` celles écrites avec un
autre preset, sans rien modifier. Pour réécrire une note précise :

```bash
okb revise parcours/03-source.md --file <brouillon.md> --reason "plus simple"
```

La révision est une proposition comme les autres (diff, approbation, reçu,
retour arrière). Elle est refusée si une citation, un bloc ou un fragment de
code, une définition de note de bas de page ou une référence `[^…]` disparaît
ou change d’un octet, ou si le frontmatter change ailleurs que `title`,
`description`, `tags`. La note revient en `draft` ; une vérification antérieure
passe dans `x_okb.prior_verified`.
Les titres de niveau 2 restent présents avec le même texte, aux émojis près.
Une traduction par révision conserve donc ces titres et les extraits de source
dans leur langue d’origine.

## Limites

Les fiches concepts issues d’un dossier v2 utilisent les titres localisés de
leur modèle et les libellés du style, comme les articles. Seuls le français et
l’anglais ont actuellement des libellés fournis ; les autres langues reprennent
ceux en anglais. Les anciennes fiches heuristiques et les dossiers v1 gardent
leurs libellés français fixes. Le respect du ton, du niveau, de la longueur et
la traduction de la prose dépendent du modèle IA : ils se mesurent avec des cas
d’évaluation, pas avec les tests du noyau.
