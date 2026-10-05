# Réglages

Trois façons de changer un réglage, au choix :

```bash
okb settings                                  # un menu, réglage par réglage
okb settings set writing.preset=pedagogique   # directement
okb settings set profile.displayName "Mon projet"
```

ou la page **Réglages** de l’application web. Chaque réglage vaut pour la KB
active, sauf la langue d’OKB (toutes les KB). Pour une autre KB le temps d’une
commande : `-k <kb>`.

## Deux langues, indépendantes

| Réglage | Ce qu’il change |
|---|---|
| `ui.language` | la langue d’OKB : menus, messages, erreurs (`auto`, `fr`, `en`) |
| `writing.language` | la langue dans laquelle Claude rédige les notes de cette KB (`fr`, `en`, `es`, `de`, `it`, `pt`) |

Tu peux avoir OKB en français et une KB rédigée en anglais. En automatique, OKB
suit la langue de ton système. Pour une seule commande : `OKB_LANG=en okb status`.

## Le style d’écriture

| Réglage | Valeurs |
|---|---|
| `writing.preset` | `standard` ★, `pedagogique` (exemples, analogies, schémas), `expert` (dense, sans rappel des bases) |
| `reader.level` | `beginner`, `intermediate` ★, `expert` |
| `kb.requireTemplate` | chaque nouvelle note suit un modèle (mêmes sections dans le même ordre) |
| `conceptAssist.level` | fiches concepts : `off`, `targeted` ★ (les notions utiles au sujet), `pedagogical` (aussi les fondamentaux) |

Changer de style ne réécrit jamais les notes existantes. Pour réécrire une note
dans un autre style : `/okb:revise` dans Claude. La page **Modèles et style**
montre les consignes exactes que suit Claude.

## Mémoire et historique

| Réglage | |
|---|---|
| `focus.file` · `focus.journal` | où sont ta note de focus et ton journal (hors de la KB) |
| `focus.sessionStart` | donner le focus à Claude au début de chaque session |
| `focus.staleDays` | après combien de jours OKB te propose de le mettre à jour |
| `git.autoCommit` | un commit Git par changement appliqué ; l’envoi (`git push`) reste manuel |

## Plusieurs KB

Une KB par sujet ou par projet, chacune dans son dossier, avec ses propres
réglages. Un même nom partout : « Finance » → dossier `kb-finance`, nom court
`finance`.

```bash
okb new                          # créer une KB : tu choisis son nom
okb kb                           # la liste ; changer de KB active
okb kb switch finance
okb kb add ~/Documents/notes     # connecter un dossier de notes existant
okb kb remove ancien             # la retirer d’OKB, sans toucher à ses notes
```

Sépare deux KB quand le partage, la confidentialité ou le niveau de lecture
diffèrent ; sinon, une KB avec des dossiers, pour que les notes se lient entre elles.

Deux KB ne partagent jamais un dossier. L’application web fait tout cela aussi,
page **Mes KB** : *Nouvelle KB*, *Connecter un dossier de notes existant*,
*Vérifier le format*, *Retirer d’OKB*.

### Retirer une KB

`okb kb remove <kb>` (ou *Retirer d’OKB* dans l’application web) la déconnecte :
ses réglages sont mis de côté dans `~/.okb/archive/`, **ses notes restent dans
leur dossier**. Pour la reconnecter plus tard : `okb kb add <dossier>`. OKB ne
supprime jamais tes notes : si tu veux effacer le dossier, fais-le toi-même.

### Une ancienne KB, au format OKB

Un dossier de notes écrit avant OKB (une ancienne KB, un coffre Obsidian) se
connecte puis se convertit, sans perdre un mot :

1. **Connecter** : `okb kb add <dossier>`. OKB te demande son nom et si elle doit
   rester sur cet ordinateur (KB confidentielle). Il n’écrit aucune note : il
   marque seulement le dossier comme le sien (`.okb/owner.yaml`).
2. **Convertir** : dans Claude Code, `/okb:convert` (ou « convertis cette KB au
   format OKB »). Claude lit chaque note et choisit son modèle, donc sa
   catégorie, son titre et une description d’une phrase tirée de la note. OKB
   prépare alors **une seule proposition** :
   - il ajoute à chaque note l’en-tête qui lui manque (type, titre, description,
     statut, catégorie), en gardant les champs qu’elle avait déjà ;
   - il transforme les liens Obsidian `[[…]]` en liens Markdown qui marchent
     partout ;
   - il range chaque note dans le dossier de sa catégorie (`concepts/`,
     `guides/`…), en réécrivant tous les liens vers elle.
3. **Relire et approuver**, comme toute proposition. `okb undo` revient en arrière.
4. Ensuite, OKB propose la page d’accueil (`okb nav`) et, pour tes notes les plus
   importantes, une réécriture dans leur modèle, une par une.

Le texte des notes n’est pas réécrit par la conversion. Ce que Claude ne peut pas
classer sans doute (une famille de notes, un doublon), il te le demande. Sans
Claude : `okb kb convert` écrit un plan à compléter, puis `okb kb convert
--plan-file <plan>` prépare la proposition.

## Cohabiter avec d’autres outils

Tu as peut-être d’autres bases de connaissances : un agent support et sa KB, un
wiki d’équipe, un serveur MCP de documentation. OKB les respecte :

- **Il n’écrit que dans ses propres KB**, celles qu’il a créées ou que tu as
  adoptées (un fichier `.okb/owner.yaml` les marque). Un dossier qui contient des
  notes d’un autre outil est refusé.
- **Il ne se propose pas pour elles.** Quand tu parles de « la KB support », OKB
  ne prend pas la main ; si tu dis seulement « la KB » et qu’un autre outil de
  connaissance est installé, il te demande laquelle tu vises.
- **Il ne propose jamais un coffre Obsidian où il n’a pas de KB** comme
  emplacement d’une nouvelle KB : un coffre partagé reste à l’écart, sauf si tu
  le choisis toi-même.

OKB détecte seul les plugins et serveurs MCP installés. Pour lui en signaler
d’autres :

```bash
okb settings set routing.otherKnowledgeTools="support-kb, wiki produit"
```

Et si tu préfères qu’OKB ne propose jamais rien de lui-même dans Claude :

```bash
okb settings set routing.suggest=false
```

## Réglages avancés

`okb settings show` liste tout, avec la valeur recommandée. Les politiques
d’organisation ou d’équipe (fichiers YAML partagés) peuvent seulement restreindre
ce qu’un profil permet : voir [l’installation détaillée](../dev/INSTALL.md).
