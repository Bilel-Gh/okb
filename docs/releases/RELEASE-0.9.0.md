# Version 0.9.0

Cette version organise **tout le travail sur une équipe de repos** : une KB de
travail avec une pièce par repo, mise en place en trois commandes.

- **`okb repo add --all <dossier> --kb <ta KB>`** enregistre d'un coup chaque
  repo d'un dossier, y compris rangé un niveau plus bas, et en dresse la carte
  sans IA. Une KB rangée dans le même dossier n'est pas prise pour un repo.
- **La conversion connaît tes repos.** Une ancienne note qui parle surtout d'un
  repo de la KB est proposée dans `repos/<repo>/`. Ce qui en concerne plusieurs
  reste dans les dossiers généraux.
- **`/okb:ticket` au début d'un ticket.** Claude cherche dans toute la KB ce que
  le ticket touche et donne :
  - les notes à lire ;
  - les fichiers qui vont changer ;
  - les questions ouvertes ;
  - un plan.

  Il n'écrit rien avant la fin du ticket.
- Le nom d'une KB de travail créée depuis `okb repo add` n'est plus pré-rempli.
- Guide : [Tous les repos d'une équipe : une KB de travail](../guide/repos.md#tous-les-repos-dune-équipe--une-kb-de-travail).

Vérification : `npm run release:check`. Nouveau test : une note est rangée avec
le repo dont elle parle.
