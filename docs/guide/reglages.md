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
okb new                # créer une autre KB (le même assistant que okb init)
okb kb                 # la liste ; changer de KB active
okb kb switch finance
okb kb archive ancien  # la retirer d’OKB, sans toucher à ses fichiers
```

Sépare deux KB quand le partage, la confidentialité ou le niveau de lecture
diffèrent ; sinon, une KB avec des dossiers, pour que les notes se lient entre elles.

Deux KB ne partagent jamais un dossier. Pour une KB existante qui n’a pas été
créée par OKB, l’assistant te demande explicitement si tu veux l’**adopter**
(`okb kb adopt`).

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
