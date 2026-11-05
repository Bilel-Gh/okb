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

Deux choix simples : le **style** et la **longueur**.

| Réglage | Valeurs |
|---|---|
| `writing.preset` : le style | **normal** ★ (`standard`), **simplifié** (`pedagogique` : mots simples, exemples, schémas), **technique** (`expert` : dense, sans rappel des bases) |
| `writing.detail` : la longueur | **courte** (`essential`), **normale** ★ (`standard`), **détaillée** (`thorough`) |
| `reader.level` | `beginner`, `intermediate` ★, `expert` |
| `kb.requireTemplate` | chaque nouvelle note suit un modèle (mêmes sections dans le même ordre) |
| `conceptAssist.level` | fiches concepts : `off`, `targeted` ★ (les notions utiles au sujet), `pedagogical` (aussi les fondamentaux) |

Chaque type de note a sa longueur, quel que soit ton réglage général :

| Type | Longueur par défaut | Réglage |
|---|---|---|
| un concept, et toute fiche « une minute » (recette, erreur connue, antisèche) | courte | `writing.byType.concept.detail` |
| un guide | détaillée | `writing.byType.guide.detail` |
| une décision | courte, avec son pourquoi | `writing.byType.decision.detail` |
| un compte rendu de réunion | normale | `writing.byType.meeting.detail` |
| les autres types | ton réglage général | `writing.byType` dans `profile.yaml` |

`okb style types` montre la longueur et le style de chaque type. `okb style
--type concept` montre les consignes exactes que suit Claude pour un concept.
Pour une seule demande : `--style simplifié`, `--length détaillée`.

Changer de style ne réécrit jamais les notes existantes. Pour réécrire une note
dans un autre style : `/okb:revise` dans Claude. La page **Modèles et style**
montre les consignes exactes que suit Claude.

## Mémoire et historique

| Réglage | |
|---|---|
| `kb.space` | l'espace de ce cerveau : `baggage` (**Mon bagage** : ce qui t'appartient et te suit) ou `work` (**Travail** : un employeur ou un client). Les deux ne se mélangent jamais ; voir [les espaces](espaces.md) |
| `focus.file` · `focus.journal` | où sont ta note de focus et ton journal (hors de la KB) |
| `focus.sessionStart` | donner le focus à Claude au début de chaque session |
| `focus.staleDays` | après combien de jours OKB te propose de le mettre à jour |

### Tes KB restent locales

Une KB est un simple dossier sur ton ordinateur. OKB ne la met jamais sous Git,
ne fait aucun commit et n'ajoute aucun remote. L'annulation (`okb undo`) repose
sur ses propres sauvegardes, dans `~/.okb/`. Si tu veux un historique ou une
copie ailleurs, c'est toi qui t'en occupes, avec tes propres outils.

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

Par défaut, OKB reste en arrière-plan (`presence: quiet`) : Claude reçoit un
brief court au début de la session, commence sa première réponse par une ligne
qui dit où en est le ticket, et ne te propose ni commande, ni carte, ni
vérification pendant le travail. Pour retrouver les propositions de la 2.4 :

```bash
okb settings set presence=assist
```

Avec `presence: assist`, tu peux encore couper les seules propositions de
commandes :

```bash
okb settings set routing.suggest=false
```

Le greffier, qui lit tes conversations finies pour tenir le journal et les
notes, est éteint par défaut : `okb scribe on` (après coup) ou
`okb scribe on --live` (en direct aussi). Voir [le greffier](greffier.md).

## Réglages avancés

`okb settings show` liste tout, avec la valeur recommandée. Les politiques
d’organisation ou d’équipe (fichiers YAML partagés) peuvent seulement restreindre
ce qu’un profil permet : voir [l’installation détaillée](../dev/INSTALL.md).
