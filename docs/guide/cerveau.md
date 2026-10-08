# Ton cerveau : l'organisation « Zoom »

Un **cerveau** est une KB rangée toujours de la même façon. Tu ne te demandes
plus « où je mets ça ? » : OKB le sait, et Claude aussi.

## Les cinq tiroirs

| Tiroir | La question | Exemples (cerveau Travail) |
|---|---|---|
| `0 Entrée` | pas encore rangé | captures rapides |
| `1 Écosystème` | le monde autour | l'entreprise, les clients, les concurrents, les concepts |
| `2 Produits` | ce sur quoi tu travailles | un dossier par produit, ses repos, ses tickets |
| `3 Boîte à outils` | ce qui sert partout | méthodes, recettes, règles d'équipe, checklists |
| `4 Activité` | ce qui s'est passé | semaines, réunions, formations, carrière |

Les noms changent selon le cerveau : **Projets perso**, **Sujets** (pour
apprendre), **Carrière** (portable).

## Le Zoom

```
2 Produits/Atlas/                         ← le produit : en 5 min, fonctionnel, architecture
2 Produits/Atlas/Code/atlas-api/          ← un repo : démarrer, architecture, déboguer…
2 Produits/Atlas/Code/atlas-api/Tickets/2026/ABC-123 — Export CSV.md
```

- Chaque dossier a sa page « en 5 min » (`Atlas/Atlas.md`) : ce qu'il faut savoir
  avant d'ouvrir le reste.
- Chaque note commence par un fil d'Ariane : `🧭 🧠 Travail › Produits › Atlas › atlas-api`.
- **L'ascenseur** : un fait va au niveau le plus bas qui le porte (un piège de
  `atlas-api` reste dans `atlas-api`) ; une leçon monte au niveau le plus haut où
  elle reste vraie (une méthode de débogage va dans la boîte à outils).

## Commandes utiles

| Tu veux | Commande |
|---|---|
| voir où irait une note | `okb where ticket --product Atlas --repo atlas-api --ref ABC-1 --title "Export"` |
| les types de note | `okb brain types` |
| le contexte d'un sujet (parents, enfants, concepts) | `okb brain context "2 Produits/Atlas"` |
| où tu en es (objectif, tickets, échéances, attentes) | `okb now` |
| les produits et leurs repos | `okb product`, `okb product show Atlas` |
| passer une ancienne KB en cerveau | `okb brain migrate` (une proposition, rien ne bouge avant ton accord) |
| essayer sans risque | `okb brain demo <nouveau dossier>` (un cerveau fictif d'environ 400 notes) |

Dans l'application web : **Cerveau** (les tiroirs et les sujets), **Graphe** (par
niveaux : un clic ouvre un produit, puis un repo).
