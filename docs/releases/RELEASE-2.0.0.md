# Version 2.0.0 — en préparation

> **« Je lui confie mon travail. »** La 2.0 pose le socle : un deuxième cerveau
> fiable, simple, qui garde le fil du travail. Le détail est dans
> `docs/dev/specs/2026-10-10-2.0-socle.md`.

Ces notes grandissent à chaque itération.

## Itération 1 — la confiance d'abord

- **Une seule porte vers l'IA.** Traduire, « Demander » et l'examen d'un repo passent
  par le même contrôle :
  - un secret où que ce soit (question, titre, terme) et rien ne part ;
  - une note 🔒 ne part qu'avec ton accord pour son contenu actuel ;
  - les termes de tes fiches 🔒 ne sont plus donnés à l'IA ;
  - le budget est vérifié avant l'appel, et une réponse coupée compte ce qu'elle a
    consommé.
- **Plus d'écriture perdue.** Deux ajouts en même temps au journal d'un ticket, deux
  cartes suggérées à la fois, deux réglages enregistrés ensemble : tout est gardé.
  Cela vaut aussi entre le terminal et l'application.
- **L'architecture calculée** :
  - un flux garde l'appel que tu as choisi ;
  - un appel n'est relié qu'à une route de la même méthode, sinon il devient une
    question ;
  - deux appels `/health` vers deux services restent deux appels.
- **Corrections** :
  - les étoiles des notes suivent chaque note et tes avis ;
  - une note faite seulement de code se traduit en entier ;
  - un pack déjà fusionné ne paraît plus modifié ;
  - une carte de révision n'est notée qu'une fois ;
  - une erreur de chargement n'est plus affichée comme « rien n'attend ton oui » ;
  - « Aller au contenu » ne change plus d'adresse.

Décision : D56. Vérification : `npm run release:check` (676 tests).

## Itération 2 — la vitesse sur un gros cerveau

OKB ne relit plus toutes tes notes à chaque clic : il garde ce qu'il a lu et ne
relit que les notes qui ont changé. Sur un cerveau fictif de 4 715 notes :

| | Avant | Après |
|---|---:|---:|
| Une recherche, une fois l'app ouverte | 4 s | 0,08 s |
| L'accueil | 13 s | 0,44 s |
| Une recherche juste après une modification | 4 s | 0,26 s |
| La toute première recherche | 9,6 s | 1 s |

Une modification faite dans Obsidian ou dans un autre éditeur se voit toujours à la
requête suivante. Quand tu approuves une proposition, OKB relit tout le disque avant
d'écrire, comme avant.

Pour mesurer toi-même : `npm run bench:speed` (sans IA, sans token).

Décision : D57.

## Itération 3 — un seul moteur

- **Les mêmes réponses partout.** Une recherche donne les mêmes notes, dans le même
  ordre, que tu la fasses dans l'application ou le terminal. La recherche du
  terminal tient maintenant compte des étoiles des notes.
- **Les assistants du terminal se branchent par MCP** : `claude mcp add okb -- okb mcp`.
  Ils cherchent et lisent tes notes, voient l'état de ta KB et te proposent des
  cartes. Ils ne voient jamais une note 🔒 et ne décident jamais à ta place.
  Voir [brancher un assistant](../guide/assistants-mcp.md).
- **Un module éteint l'est partout** : ses actions disparaissent aussi des
  assistants, et tes notes restent lisibles.
- **Une demande mal formée** est refusée avec le nom du champ en cause.

Décision : D58.
## Itération 4 — le grand ménage

L'application garde son apparence (le thème Atelier), mais elle est rangée autrement.

- **Cinq écrans** au lieu de treize destinations : Aujourd'hui, Projets, Mémoire,
  Assistant, Progresser. Rien n'a disparu : chaque ancienne page est dans un écran,
  et tes anciens favoris ouvrent la bonne page.
- **En haut de chaque écran** : Chercher (⌘K), **Garde ça** (⌘J) pour noter une
  ligne tout de suite, et **À valider** avec le nombre de choses qui attendent ton oui.
- **Le menu Plus** range ce qui n'est pas quotidien : outils, santé, modules, aide.
- **Projets** : un nouvel écran. Un projet dit où il en est en une phrase et sa
  prochaine étape. Avec le module développeur, tes tickets et tes repos y sont déjà.
- **Des mots simples** : plus de « KB » ni de « proposition » à l'écran. On dit
  « tes notes », « changement prêt à relire », « note à écrire ».
- **Sources et validité**, sous chaque note : d'où vient ce qu'elle dit, qui l'a
  écrite, quand tu l'as approuvée, jusqu'à quand elle tient, et un bouton pour
  vérifier si ses sources ont changé.
- **Le graphe** montre d'un clic les notes hors des tiroirs et celles que rien ne relie.
- **L'ancienne interface** (`/classic`) est retirée : son adresse mène à l'application.

À savoir : OKB demande maintenant Node 22.13 ou plus récent.

Décision : D59.
