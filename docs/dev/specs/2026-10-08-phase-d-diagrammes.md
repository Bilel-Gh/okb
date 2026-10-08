# Phase D — des diagrammes d'architecture calculés depuis le code

> Spec écrite en autonomie (« continue » de l'utilisateur, carte blanche). Source :
> roadmap §4. Choix seuls marqués **[à valider]**.

## Le problème

Les diagrammes d'architecture, surtout ceux qui relient les repos entre eux, sont
écrits librement par Claude à partir de ce qu'il a lu : noms techniques, flèches
devinées, pas de preuve. On veut l'inverse : **le schéma vient du code, l'IA
l'explique.**

## Ce qui existe

`okb repo scan` détecte ce qu'un repo expose (routes HTTP, services CDS/OData,
OpenAPI, GraphQL, gRPC, événements émis) et consomme (destinations, services
externes, bases, files, paquets internes, URL), avec fichier:ligne.
`landscapeEdges` relie des repos par paquet, événement et nom de service.

## Ce qu'on ajoute

### 1. Le modèle du système, sans IA (`src/arch/model.ts`)

- **Nouvelles détections** dans le scan :
  - **appels HTTP sortants** : `fetch(url, { method })`, `axios.get|post…(url)`,
    `http(s).request`, `got`, `ky`, `requests.get|post` (Python), `RestTemplate`,
    `WebClient` (Java) — méthode, chemin, et la base d'URL quand elle vient d'une
    variable (`process.env.ORDERS_URL`, `${BASE}/orders`) ;
  - **événements publiés et écoutés** : Kafka (`producer.send({ topic })`,
    `consumer.subscribe({ topic })`), RabbitMQ (`publish`, `consume`), en plus de
    l'existant.
- Le modèle : des **nœuds** (repos, bases, files, systèmes externes) et des
  **liens** typés (appelle, publie/écoute, dépend de, lit/écrit), chacun avec ses
  **preuves des deux côtés** et une **confiance** (`sûr`, `probable`, `à confirmer`).

### 2. Relier les repos par correspondance (`src/arch/links.ts`)

| Lien | Correspondance | Confiance |
|---|---|---|
| appel HTTP | même méthode + même chemin normalisé (`/orders/:id` = `/orders/{id}` = `/orders/${id}`) chez un autre repo | sûr ; probable si seul le chemin correspond |
| appel par variable d'hôte | `ORDERS_URL` ↔ repo dont le nom contient `orders` | probable |
| événement | même sujet publié ici, écouté là | sûr |
| paquet interne | dépendance ↔ paquet publié par un autre repo | sûr |
| service nommé | destination / service externe ↔ service fourni du même nom | probable |

Un appel sans correspondance devient une **question** (« qui sert `POST /refunds` ? »),
jamais un trait inventé.

### 3. Des vues générées (`src/arch/views.ts`)

- **Contexte** : le système (un produit ou l'espace de travail) et ses voisins
  externes.
- **Conteneurs** : les repos, leurs bases et files ; au plus **12 boîtes**, le reste
  regroupé (« 3 autres services »).
- **Flux** : un diagramme de séquence par flux principal, en suivant la chaîne
  d'appels depuis une interface (UI ou route d'entrée).
- **Des noms compréhensibles** : chaque boîte porte un nom métier (« Service des
  commandes »), tiré de la description du repo, de son README ou de sa note ;
  l'identifiant technique dessous, en petit. Une légende.
- **Des flèches avec un verbe**, dans le sens de l'appel (« crée la commande »,
  dérivé de la méthode et du chemin : `POST /orders` → « crée orders »).

### 4. L'auto-évaluation (`src/arch/check.ts`)

Avant de proposer un diagramme, OKB le note sur 100 :
- chaque boîte et chaque flèche a sa preuve ;
- des noms lisibles (pas d'identifiant seul, pas d'abréviation sans explication) ;
- pas de boîte isolée sans raison ; flèches avec un verbe ;
- au plus 12 boîtes ; les mêmes noms d'une vue à l'autre.

En dessous de 80, les manques sont listés plutôt qu'un mauvais schéma montré.

### 5. Un jeu de test (`tests/fixtures/arch`)

Un espace fictif de **5 repos** dont on connaît l'architecture exacte (boutique web →
API commandes → API paiements ; les commandes publient `order.created`, la
logistique l'écoute ; une bibliothèque interne partagée ; une base Postgres). On
mesure : **liens justes, inventés, manqués**. Objectif : 0 inventé, ≥ 90 % trouvés.

### 6. Dans l'application

Le **plan du système** dessiné comme un plan de métro (le monde de la refonte) :
chaque repo une station, les liens des lignes ; un clic sur un lien montre ses
preuves des deux côtés ; un clic sur un repo ouvre sa page. Onglet « Architecture »
de la page Repos. **[à valider]**

### 7. Pour Claude

- `okb arch [--view context|containers|flow] [--json]` : le modèle et les vues,
  pour que Claude explique au lieu d'inventer.
- Un agent **relecteur d'architecture** (grille du §4) que les compétences
  d'onboarding appellent avant de proposer un schéma.

## Hors de cette phase

- Lecture du code par arbre syntaxique (tree-sitter) et communautés (graphology,
  Louvain) : étape suivante, derrière la même interface `model.ts` ; Graphify sert
  d'étalon, jamais de dépendance.
- Mesure sur Sonnet et Opus : nécessite les évals (connexion Claude).
