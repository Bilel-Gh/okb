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
