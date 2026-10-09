# Le graphe et les catégories

Ta KB va grandir : des centaines de notes, plusieurs sujets, plusieurs repos.
Deux outils t'aident à t'y retrouver :

- **les catégories**, qui donnent à chaque note une couleur selon ce qu'elle
  contient ;
- **le graphe**, qui montre toutes tes notes et les liens entre elles.

## Les catégories

Chaque note appartient à une seule catégorie. Sa couleur est la même partout :
dans le graphe, la liste des notes, la recherche, la relecture des propositions
et le terminal.

| | Catégorie | Ce qu'on y range | Modèles |
|---|---|---|---|
| 🟣 | 💡 **Concepts** | une notion expliquée en une minute | `concept` |
| 🔵 | 📘 **Comprendre** | comment marche un sujet ou un système | `guide`, et l'aperçu, l'architecture, les interfaces et la carte du code d'un repo |
| 🟢 | 🪜 **Faire** | les procédures à suivre et les **tutos** pour apprendre en faisant | `procedure`, `tutorial`, et « démarrer » et « livrer » d'un repo |
| 🩵 | 🔁 **Process et outils** | comment l'équipe travaille, les outils, ce qui est automatisé | `process`, `tool`, `automation` |
| 🟠 | 🧯 **Cas et retours** | ce qui s'est vraiment passé : **cas clients**, incidents, tickets | `experience`, `client-case`, ticket d'un repo |
| 🔴 | ⚖️ **Décisions** | un choix et ses raisons | `decision` |
| 🟡 | 🗣️ **Réunions et sources** | l'essentiel d'une réunion, d'une vidéo, d'un document | `meeting` |
| 🩷 | 🧭 **Parcours** | quelles notes lire, dans quel ordre, pour maîtriser un sujet | `path` |
| ⚪ | 📄 **Autres** | les notes écrites sans modèle | — |

**Personne n'a à ranger quoi que ce soit.** Quand Claude prépare une note, il
choisit un modèle adapté (un tuto, un cas client, une décision…). Ce modèle
décide de sa catégorie et de son dossier (`tutos/`, `cas-clients/`,
`decisions/`…). Pour une note écrite à la main, la catégorie se déduit dans
cet ordre :

1. un choix explicite (`x_okb.category`) ;
2. le modèle ;
3. le type ;
4. le dossier.

Trois modèles sont nouveaux :

- **tuto** : apprendre à faire une chose en comprenant chaque étape ;
- **cas client** : le client et son contexte, le besoin, ce qui a été fait, les
  résultats, ce qu'on en retient ;
- **parcours** : un chemin de lecture vers d'autres notes, dans le bon ordre.

### Changer la catégorie d'une note

- Dans l'application web, clique sur la pastille de catégorie en haut de la
  note, puis choisis la nouvelle.
- Dans le terminal :

```bash
okb categories set brouillons/idees.md guide
```

Comme tout changement, cela prépare une **proposition** que tu approuves. Le
texte de la note ne change pas. Avec `auto`, la note redevient classée par son
modèle.

`okb categories` montre la répartition de ta KB et les notes sans catégorie.
`okb maintain` les signale aussi.

### Tes propres catégories

Une KB peut renommer, recolorer ou ajouter des catégories dans
`.okb/categories.yaml`. Par exemple, pour séparer les clients des incidents :

```yaml
categories:
  - id: client
    label: { fr: Clients, en: Clients }
    emoji: "🏢"
    color: "#0f766e"
    templates: [client-case]
    folders: [clients]
```

Une catégorie qui prend un modèle, un type ou un dossier le retire de celle qui
l'avait.

## Le graphe

![Le graphe d'une KB fictive](../images/web-graph.png)

Dans l'application web (`okb serve`), page **Graphe** :

- **les notes sont regroupées par thème**, détecté tout seul à partir des liens
  (méthode de Louvain : des groupes de notes bien plus liées entre elles qu'avec
  le reste). En général, un thème réunit un guide et les concepts qu'il explique.
  Chaque thème a un halo et un nom (voir plus bas). La liste « Thèmes détectés »
  montre les notes de chaque thème et le cadre d'un clic ;
- **chaque point est une note**, coloré par catégorie, plus gros quand la note
  est très reliée ;
- **chaque trait est un lien** d'une note vers une autre ; les pointillés
  marquent un prérequis (« à lire avant ») ;
- **molette** pour zoomer, **glisser** pour te déplacer, glisser un point pour le
  bouger ;
- **survoler** un point allume ses voisins ; **cliquer** ouvre un panneau (résumé,
  notes reliées) ; **double-cliquer** ouvre la note ;
- **« Son voisinage »** ne garde que la note et ce qui l'entoure (à 1, 2 ou 3 liens) ;
- **à droite**, l'onglet **Types** masque ou affiche un type d'un clic, l'onglet
  **Thèmes détectés** liste les thèmes (leurs notes, leur mélange de types) et cadre
  celui que tu choisis ; cliquer une note ouvre sa fiche à la place ;
- **regrouper** en haut : par **thèmes**, par **types**, par **dossiers**, ou
  **libre** ;
- **les options** (l'icône à côté) : quand montrer les titres, les notes isolées,
  les pages de navigation et, dans un espace de travail, le repo à mettre en avant ;
- **les titres ne se chevauchent jamais** : ceux des notes les plus reliées
  d'abord, les autres apparaissent en zoomant ; survoler une note affiche ses
  voisines ;
- **la recherche** allume les notes trouvées et va sur celle que tu choisis ;
- **« Vu d'en haut »** montre ton cerveau tiroir par tiroir, en bulles : un
  double-clic descend d'un niveau, le fil d'Ariane remonte.

### Le nom des thèmes

Personne ne nomme les thèmes : OKB prend, dans l'ordre :

1. **le guide qui explique le thème**, s'il est relié à au moins la moitié de ses
   notes (un guide, un parcours, une procédure ou un process). Exemple : « Le
   cycle d'une affaire » pour Affaire, Devis, Avenant et REX ;
2. sinon **un tag** que portent la plupart de ses notes, et presque aucune autre.
   Exemple : « Second cerveau » pour le tag `second-cerveau` ;
3. sinon un guide relié à au moins un quart du thème ;
4. sinon la note la plus centrale du thème.

Une page d'accueil reliée à tous les thèmes ne donne son nom à aucun. Le nom garde
l'essentiel du titre : sans emoji ni sous-titre (« La finance d'une affaire : du
coût réel… » devient « La finance d'une affaire »). Survoler un thème dans la liste
dit d'où vient son nom.

Pour qu'un thème porte un meilleur nom, écris (ou fais écrire) le guide qui
l'explique : c'est aussi la note qui manque à qui découvre le sujet.

Sous chaque note, le **graphe local** montre ses voisins. Les listes **« Cité
par »** et **« Liens vers »** donnent les liens exacts, lus dans le texte des
notes.

## Et Obsidian ?

L'application web fait maintenant tout ce dont tu as besoin au quotidien :

- lire, chercher, voir le graphe ;
- relire et approuver ;
- réviser, faire la revue de la semaine.

Obsidian devient **facultatif**. Il reste utile si tu veux :

- écrire une note à la main avec un vrai éditeur ;
- lire tes notes sur téléphone avec la synchronisation d'Obsidian ;
- utiliser ses plugins (canvas, cartes mentales…).

Tes notes sont de simples fichiers Markdown : tu peux arrêter ou reprendre
Obsidian quand tu veux, rien ne change pour OKB.
