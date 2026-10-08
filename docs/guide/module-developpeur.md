# Le module développeur (`okb-dev`)

Un module qui s'ajoute au plugin `okb`, pour ceux qui travaillent sur du code.
Il range tout dans le cerveau Travail (ou Projets perso).

| Tu dis | Commande | Ce qui se passe |
|---|---|---|
| « documente le produit Atlas » | `/okb-dev:product` | ce que le produit a déjà et ce qui manque (fonctionnel, architecture), une note à la fois avec ton oui |
| « je découvre ce repo » | `/okb-dev:onboard` | la carte du repo, sa lecture complète, ses notes citées dans le code |
| « je commence le ticket ABC-123 » | `/okb-dev:ticket` | ce que la KB sait du ticket ; à la fin, les notes à garder (ticket, pièges, règles, réussite) |
| « explique-moi ce fichier » | `/okb-dev:explain` | d'abord ce que l'équipe a écrit, puis le code, à ton niveau |
| « aide-moi à débugger » | `/okb-dev:debug` | l'erreur est-elle déjà connue ? puis une méthode ; l'erreur résolue peut devenir une note |
| « relis mes changements avant la PR » | `/okb-dev:review` | une pré-revue avec les règles de l'équipe, les leçons de revue et les pièges connus |
| « rédige le message de commit » | `/okb-dev:ship` | le message et la description de PR, dans le style de l'équipe et son modèle de PR |
| « un client remonte que… » | `/okb-dev:support` | déjà vu ?, où dans le produit et le code, une réponse au client à copier |

Ce que Claude lit pour t'aider, sans IA :

- `okb dev review` : les règles d'équipe, les conventions du repo, les notes sur
  chaque fichier modifié, les pièges ;
- `okb dev ship` : les commits, les fichiers, le ticket suivi et son journal, le
  style des commits de l'équipe, le modèle de PR.

Claude ne committe, ne pousse et n'ouvre une PR qu'après ton accord, avec le
texte que tu as vu. Par défaut, il n'ajoute ni ligne « généré avec » ni
co-auteur (réglage `dev.attribution`).
