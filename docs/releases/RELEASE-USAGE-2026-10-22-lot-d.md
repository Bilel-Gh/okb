# Une carte qui dit vrai, et l’équipe responsable — 22 octobre 2026

Checkout de développement non publié ; le numéro du paquet reste 2.0.0.

- **F2.4-15, D72** : chaque adresse écrite dans le code reçoit un rôle. Seuls
  les appels et les adresses en configuration deviennent des ressources
  externes ; registres de paquets, hébergement du code, liens de documentation,
  polices, CDN et plateforme sont rangés dans « Pas sur la carte ». Le scan lit
  aussi `@PostMapping` sans parenthèses et `kafkaTemplate.send` en Java. Un seul
  moteur sert la carte, la page Repos, la note Paysage, le brief et MCP.
- **F2.4-16** : chaque relation dit sa certitude (prouvée, déclarée, supposée,
  confirmée) et pourquoi ; un nom ou une adresse qui ressemble à un autre repo
  donne une relation supposée.
- **F2.4-17** : confirmer, exclure, recibler, ajouter une relation ; classer une
  adresse une fois pour tous les repos. Les scans suivants respectent la
  correction ; une correction sans effet est signalée ; l’agent ne défait
  jamais ce que la personne a décidé.
- **F2.4-18** : filtres « Supposées » et « Ressources externes », panneau de
  relation avec ses gestes, rubrique « Pas sur la carte » ; sur la fiche d’un
  repo, une ligne par relation et « Outils et liens » à la place du Mermaid.
- **F2.4-19, D73** : l’équipe responsable d’un repo et d’un produit, avec son
  origine ; héritage du produit ; suggestion CODEOWNERS ; écarts à trancher.
- **F2.4-20** : « Demander à l’agent » pour l’équipe, avec un prompt qui dit où
  chercher.

Limites : le classement des adresses reste une lecture statique (une adresse
construite à l’exécution n’est pas vue) ; une carte scannée avant ce lot est
classée ligne par ligne, un nouveau scan donne le classement complet ; les
bases de données restent des stations sous leur repo. La note Paysage ne liste plus en « externe » les services nommés ou les files de messages sans adresse : ce qui n’est relié à aucun repo ni à aucune adresse appelée reste dans la carte du repo, pas sur le paysage.
