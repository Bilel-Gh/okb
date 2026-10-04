# Open Knowledge Format

Cible : **GoogleCloudPlatform/knowledge-catalog, OKF 0.2**.

- [Spécification figée](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62432a095456147ee71e70ac6e4dc0d2dea3ac30/okf/SPEC.md)
- Commit : `62432a095456147ee71e70ac6e4dc0d2dea3ac30`.
- SHA-256 du fichier lu : `26aa5da029278939f914e578107242d9607d4f2dc5fe153272b82f9ed1030101`.
- Vérifié le 2 octobre 2026. Le pin est codé dans `src/okf/types.ts`.

La conformité et les règles du produit sont distinctes. Selon §11, les documents
non réservés portent du YAML analysable et un `type` non vide. Les index et logs
ont leurs structures réservées. Les champs optionnels, types inconnus, extensions
et liens cassés ne justifient pas de rejeter un bundle. Les valeurs optionnelles
inhabituelles sont signalées sans devenir des erreurs de conformité fatales.

Le produit exige davantage pour ses créations : titre, description, statut draft,
auteur de génération et références. Il bloque l’introduction de nouvelles erreurs
structurelles lors d’un apply, tout en permettant de réparer une KB préexistante
imparfaite. Les diagnostics de syntaxe des ancres sont statiques : ils ne constituent
pas un test d’affichage dans toutes les versions de GitHub et Obsidian.

| Élément | Traitement |
|---|---|
| `type` | Requis ; valeurs inconnues tolérées |
| `status` absent | Interprété stable selon OKF, sans inventer une vérification |
| `verified` mapping ou liste | Les deux sont lus ; les nouveaux documents ne l’écrivent pas |
| `sources[].resource` | URL externe ou identifiant `urn:sha256:…` pour une source locale |
| `sources[].id` | Jointure avec les notes de bas de page |
| `index.md` racine | Peut déclarer `okf_version: "0.2"` |
| Autres index/logs | Sans frontmatter de document conceptuel |
| Extensions inconnues | Conservées au round-trip YAML |
| Calculs attestés | Champs conservés ; aucune exécution ou attestation automatique |

Les chemins relatifs avec extension explicite sont une règle de **portabilité du
produit**, plus stricte que les liens bundle-absolus permis par OKF. Toutes les
nouvelles destinations internes passent par le même générateur. Les espaces,
parenthèses, `%` et `#` présents dans les noms sont encodés. Les migrations protègent
code/citations et signalent les cas ambigus. Un déplacement réécrit les destinations
entrantes et sortantes ; il ne remplace pas une simple opération Git de renommage.

`x_okb` porte les alias, domaines, sens, prérequis, historiques d’import, liens
et le style d’écriture (`x_okb.writing`).
Les aides pédagogiques sont rendues en syntaxe d’alerte GitHub (`> [!TIP]`,
`> [!NOTE]`), qu’Obsidian affiche comme encadrés ; les schémas sont des blocs
` ```mermaid `. Ce sont des conventions d’affichage, pas des champs OKF.
Les localisateurs détaillés des affirmations sont des extensions de provenance
`x_okb_blocks`/`x_okb_claim_kind` dans les entrées sources. Ils n’appartiennent pas
au standard. Dans OKF, « concept » désigne largement les documents de connaissance ;
le dossier pédagogique `concepts/` est une convention supplémentaire du produit.
