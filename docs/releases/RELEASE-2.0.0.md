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

## Itération 5 — garder le fil

- **Les projets.** Un projet, c'est ce sur quoi tu travailles. Il dit où il en est en
  une phrase et sa prochaine étape. Tu en crées un pour un sujet ; avec le module
  développeur, tes tickets et tes repos en sont déjà.
- **Les actions et ce que tu attends.** Une chose à faire, avec sa date ; ce que tu
  attends de quelqu'un ; une question ouverte. Tape « réserver le car avant le 15
  mai » : OKB crée l'action « Réserver le car » pour le 15 mai, sans IA.
- **Le journal**, par jour et par projet : une note, une décision, une chose faite,
  un essai raté, une réunion.
- **« Où j'en étais ».** Quand tu quittes un projet, OKB prépare quatre lignes : fait,
  essayé, en attente, par où reprendre. Tu corriges, et tu les retrouves au retour.
- **Aujourd'hui** répond à six questions : je reprends quoi, j'ai quoi à faire,
  j'attends quoi, que s'est-il passé, qu'ai-je appris, que dois-je revoir ou comprendre.
- **Garde ça** range ta ligne dans le journal du projet que tu choisis, et te
  propose l'action qu'il y repère.
- **Dans le terminal** : `okb today`, `okb project`, `okb action`, `okb journal add`.
- **Pour les assistants** : les mêmes gestes par MCP. Ce qu'un assistant ajoute est
  marqué « proposé par l'IA ».

À savoir : les projets, les actions et le journal sont rangés dans une petite base
(`okb.db`), dans le dossier d'état de ton profil, pas dans tes notes.
Voir [projets, actions et journal](../guide/projets.md).

## Itération 6 — capturer et écrire

- **Les documents.** Un PDF, une présentation, un mail, une photo : OKB garde le
  fichier tel quel, sans jamais le modifier, et lit son texte pour que la
  recherche le retrouve. Tu le déposes dans **Mémoire › Documents**, dans un
  projet, ou avec **Garde ça › Joindre un fichier**. Dans le terminal : `okb doc`.
- **Un cadenas par document** : un document 🔒 est caché à Claude et aux assistants.
  Eux peuvent chercher dans tes documents, pas en garder ni en modifier.
- **Le style et la longueur**, en mots simples : technique, normal ou simplifié ;
  courte, normale ou détaillée. Chaque type de note a sa longueur : un concept est
  court, un guide détaillé, une décision courte avec son pourquoi, un compte rendu
  normal. Tu changes ces défauts dans les réglages.
- **Les moments repérés.** OKB repère six moments sans IA : une longue explication
  demandée, la même question deux fois, un bug résolu après plusieurs essais, une
  décision, une commande découverte, une erreur et sa cause.
- **Claude n'interrompt plus.** Ce qui est repéré attend la fin de la session : une
  seule question, **trois choses au plus**. « Pas maintenant » est retenu : les
  cartes attendent dans l'application et Claude n'en reparle pas avant une semaine.

À savoir : le réglage « Quand Claude propose de garder quelque chose » passe à « à
la fin de la session » par défaut. Pour retrouver la proposition immédiate :
`okb settings set suggest.mode live`.
Voir [les documents](../guide/documents.md) et
[rien n'est écrit sans ton oui](../guide/demander-avant-ecrire.md).

## Itération 7 — les espaces et le oui

- **Deux espaces qui ne se mélangent jamais.** **Mon bagage** : ce qui t'appartient
  et te suit toute ta vie. **Travail** : les notes d'un employeur ou d'un client.
  Tu choisis l'espace en haut à gauche, puis le cerveau.
- **Garder dans mon bagage.** Sur une note de travail, OKB prépare une version sans
  aucun détail du travail : noms, références, adresses et montants laissent place
  à des mots neutres. Tu relis, tu réécris, et la note attend ton oui dans ton
  bagage. Une version qui nomme encore le travail est refusée.
- **Le bagage ne se partage pas** : ni envoi, ni réception d'un pack.
- **Oui à tout, sauf…** « À valider » s'ouvre sur tout ce qui attend, coché. Tu
  décoches ce que tu ne veux pas et tu dis oui au reste : **une seule
  confirmation** pour tous les changements.
- **Ce que tu écris passe tout de suite** ; ce qu'un assistant prépare attend ton
  oui. Aujourd'hui te rappelle combien de choses attendent.

À savoir : un cerveau existant est rangé dans Travail, sauf un cerveau « carrière »
qui va dans Mon bagage. Pour changer : Réglages › Espace de ce cerveau.
Voir [deux espaces](../guide/espaces.md).

## Itération 8 — durer

- **Une sauvegarde qui ramène tout.** Chaque jour : tes notes, tes documents, tes
  projets, tes actions, ton journal, tes révisions et tes réglages. Aujourd'hui
  affiche « Sauvegardé », ou te prévient.
- **La restauration, réellement essayée.** `okb backup drill`, ou **Tester la
  restauration** dans Santé : la dernière sauvegarde est restaurée dans un dossier
  temporaire, vérifiée, comptée. `okb backup restore <date> --to <dossier> --as
  <nom>` ramène un cerveau entier comme nouveau cerveau.
- **Passer de la 1.5 à la 2.0** : `okb migrate 2.0` montre ce qui va se passer sans
  rien changer ; `--apply` le fait, sauvegarde d'abord ; `--rollback` revient en
  arrière. Tes notes ne sont jamais touchées.
- **Quatre indicateurs séparés** dans Santé et `okb indicators` : couverture,
  fraîcheur, qualité, compréhension. Chacun dit de quoi il est fait, et chaque
  manque mène à un geste. Pas de chiffre quand il n'y a rien à mesurer.
- **Ce que j'ai fait mardi.** Tape « mardi », « hier » ou une date dans la recherche
  (⌘K), ou `okb journal mardi` : le journal de ce jour-là.
- **Les mesures** dans `okb metrics` : le temps pour retrouver un jour, le temps
  d'entretien par jour, les tokens par jour.
- **Plus solide** : deux fenêtres qui écrivent en même temps, une coupure en pleine
  écriture, l'application lancée deux fois — c'est testé.

Voir [passer de la 1.5 à la 2.0](../guide/passer-a-la-2-0.md) et
[stockage et sauvegardes](../guide/stockage-et-confidentialite.md).

Décision : D60.
