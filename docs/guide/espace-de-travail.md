# Plusieurs repos : l'espace de travail

Si tu ranges les repos d'une équipe dans un même dossier, OKB en fait un
**espace de travail** :

- **une seule KB** pour toute l'équipe, avec **un espace par repo** et une partie
  **commune** ;
- OKB **se concentre tout seul** sur le repo et le ticket dont tu parles ;
- ce que tu apprends pendant un ticket **remonte au bon endroit** : dans l'espace
  du repo, ou dans la partie commune quand ça dépasse ce repo.

Cette page concerne surtout les développeurs. Si tu n'utilises pas de repos de
code, tu n'en as pas besoin. Pour choisir entre un espace de travail et une KB
pour un seul repo : [Choisir son organisation](choisir-son-organisation.md).

## Ce que ça change par rapport à Claude seul

| Sans OKB | Avec un espace de travail |
|---|---|
| Ouvert sur le dossier de tous les repos, Claude ne sait pas lequel tu vises : il explore. | Tu dis « j'ai le ticket ABC-123 sur orders-service » : OKB se met sur ce repo et donne ses notes à Claude. |
| Chaque session repart de zéro et relit le code. | Au démarrage, Claude reçoit un **brief** : les notes du repo, les notes communes liées, les repos voisins, le ticket en cours. |
| Une recherche ramène les notes de tous les repos pêle-mêle. | La recherche classe **d'abord le repo**, puis les notes communes liées, et les autres repos en dernier. |
| Ce que tu découvres pendant un ticket se perd. | Les commits et les décisions sont suivis **sans dépenser de tokens**, puis deviennent une note à la fin. |
| Une règle métier apprise sur un repo reste dans ta tête. | Elle va dans la partie commune de la KB, où tous les repos la retrouvent. |

## Organiser ses dossiers

La disposition conseillée :

```text
~/dev/mon-equipe/            l'espace de travail : un dossier par équipe ou par employeur
  orders-service/
  billing-service/
  front/web-shop/            un niveau de sous-dossier est permis
~/Documents/kb-mon-equipe/   la KB, de préférence hors du dossier des repos
```

- OKB trouve les repos jusqu'à deux niveaux sous le dossier.
- Une KB rangée dans le dossier des repos n'est jamais prise pour un repo.
- **Repos éparpillés ?** Ajoute un autre dossier au même espace :
  `okb workspace add ~/autre/dossier --to mon-equipe`. Ou enregistre un repo seul :
  `okb repo add --kb <ta KB>`.
- **Plusieurs équipes ou employeurs ?** Un espace et une KB chacun. Ce qui est
  confidentiel reste séparé.

## Mise en place, une fois

```bash
okb workspace add ~/dev/mon-equipe
```

OKB te demande :
- la KB à utiliser. Une nouvelle **KB de travail confidentielle** est recommandée ;
  tu choisis son nom ;
- le nom de l'espace.

Puis, sans IA, en quelques secondes par repo, il :
- enregistre chaque repo et en dresse la carte ;
- apprend le format de vos tickets d'après les noms de branches (`ABC-123`…) ;
- prépare la note des liens entre repos (`repos/paysage.md`), à relire avec
  `okb review`.

Dans Claude Code, `/okb-dev:workspace` fait la même chose avec des boutons.

Tu as déjà une KB écrite avant OKB ? Connecte-la (`okb kb add <dossier>`), puis
`/okb:convert` : chaque note qui parle surtout d'un repo va dans son espace.

## Le périmètre : OKB se met sur le bon repo

Le **périmètre**, c'est le repo (et le ticket) sur lequel OKB se concentre. Il se
choisit de trois façons :

1. **Claude Code ouvert dans un repo** : le périmètre est ce repo.
2. **Claude Code ouvert à la racine de l'espace** : dis simplement sur quoi tu
   travailles. « j'ai le ticket ABC-123 sur orders-service » suffit : OKB bascule,
   Claude te l'indique en une ligne (🎯) et reçoit le brief du repo.
3. **À la main** : `okb scope orders-service`, `okb scope ABC-123`, ou
   `okb scope off` pour revenir à tout l'espace.

La ligne d'état de Claude Code l'affiche : `📚 Travail · 📦 orders-service · 🎫 ABC-123`.

Une question qui nomme plusieurs repos (« comment billing-service appelle
orders-service ? ») ne change pas le périmètre. Pour chercher dans toute la KB :
`okb ask "…" --everywhere`.

## Un ticket, du début à la fin

**1. Au début.** Dis « je commence le ticket ABC-123 » et colle son texte, ou
tape `/okb-dev:ticket ABC-123`. OKB suit désormais le ticket : son point de départ,
sa branche, ses commits. Claude cherche dans la KB ce que le ticket touche et te
donne :
- les notes à lire ;
- les fichiers qui vont changer ;
- les questions ouvertes ;
- un plan court.

**2. Pendant le travail.** Tout se fait sans dépenser de tokens et sans rien
écrire dans la KB :
- une branche nommée d'après le ticket (`feature/ABC-123-export`) est reconnue
  seule ;
- les commits sont relevés, même s'ils sont ensuite fusionnés en un seul ;
- quand une décision est prise ou un piège découvert, Claude le note en une
  ligne dans le **journal du ticket** (`okb ticket note "…" --kind decision`).
  Après chaque commit fait par Claude, OKB le lui rappelle.

**3. À la fin.** Dis « j'ai fini mon ticket » ou tape `/okb-dev:ticket`. Claude
rassemble les faits (texte du ticket, commits, journal, fichiers modifiés) et
prépare **une proposition**, à deux niveaux :

| Niveau | Ce qui est préparé |
|---|---|
| **Espace du repo** | la note du ticket ; « pour changer X → tel fichier » et les pièges dans la carte du code ; les notes dont le comportement a changé |
| **Partie commune** | une règle métier modifiée ; une fiche pour chaque nouveau terme métier ; le guide d'une fonctionnalité qui traverse plusieurs repos ; la carte des liens si une interface a changé |

Tu relis, tu approuves. Si le ticket est mergé sans que tu l'aies dit, Claude le
remarque à la session suivante et te propose d'écrire sa note.

## Ce qui va où

| Ce que tu as appris | Où ça va |
|---|---|
| Comment lancer ce repo, où modifier quoi, un piège de ce code | `repos/<repo>/` |
| Ce que tu as fait dans un ticket | `repos/<repo>/tickets/` |
| Une règle métier, un terme | `concepts/` |
| Une fonctionnalité qui traverse plusieurs repos | `guides/` |
| Pourquoi c'est ainsi | `decisions/` |
| Qui appelle qui | `repos/paysage.md` (calculé depuis le code) |

## Un repo avec sa propre KB

Un repo plus confidentiel, ou déjà documenté seul, peut garder sa **KB de repo**
tout en faisant partie de l'espace :
- **rattaché** : ses notes restent chez lui, la partie commune vient de l'espace.
  Un repo rangé dans le dossier de l'espace est rattaché tout seul (🔗 dans
  `okb workspace add`) ; ailleurs : `okb workspace attach <repo>`.
- **fusionné** : `okb kb merge <KB du repo> --into <KB de l'espace>` range ses
  notes dans `repos/<repo>/`, par une proposition que tu relis.

Détails : [Choisir son organisation](choisir-son-organisation.md#un-repo-avec-sa-propre-kb-dans-un-espace).

## Le graphe de l'espace

La page **Graphe** de l'application web a une **vue d'ensemble** : une bulle par
repo et par dossier commun, les appels entre repos, le repo du périmètre entouré.
La vue **Notes** a un choix « Périmètre » qui met en avant un repo, les notes
communes qui le concernent et ses voisins.

## Réglages

- **Format des tickets.** OKB reconnaît `ABC-123` et apprend vos préfixes. Pour
  les fixer : `okb workspace set mon-equipe --prefixes ABC,OPS`. Pour un autre
  format, par exemple `#123` : `--pattern "#(\d+)"`.
- **Voir et retirer.** `okb workspace` liste les espaces ;
  `okb workspace remove <espace>` en oublie un (repos et notes restent).
- **Tout reste local.** La liste des espaces et le périmètre sont dans `~/.okb/`.
  Les tickets suivis sont dans l'état privé de la KB. Rien n'est ajouté dans tes
  repos, et rien n'entre dans la KB sans ton accord.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `okb workspace add <dossier>` | crée l'espace : repos enregistrés et cartographiés, format des tickets appris |
| `okb workspace` | les espaces, leurs repos et leur périmètre |
| `okb scope` | le périmètre actuel et ce que Claude en reçoit |
| `okb scope <repo \| ABC-123 \| off>` | changer de périmètre |
| `okb ticket start ABC-123` | suivre un ticket (`--repo`, `--ticket-file`) |
| `okb ticket note "…" --kind decision\|trap\|question` | noter dans le journal du ticket |
| `okb ticket` · `okb ticket list` | où en est le ticket ; les tickets suivis |
| `okb ticket done` | les faits du ticket terminé, pour `/okb-dev:ticket` |
| `okb workspace attach <repo>` · `detach` | rattacher un repo qui a sa propre KB |
| `okb kb merge <KB du repo> --into <KB de l'espace>` | fusionner une KB de repo dans l'espace |

## Limites, honnêtement

- Un nom de repo trop courant (« api », « web ») n'est reconnu que précédé de
  « repo » : « dans le repo api ».
- Un merge « squash » n'est pas toujours reconnu comme tel : OKB indique alors
  « branche supprimée », et Claude propose quand même la note.
- Si tu travailles directement sur la branche principale, sans branche de
  ticket, OKB lit les commits au moment de `okb ticket done`.
