# Une KB pour chaque repo de code

Tu arrives sur un repo que tu ne connais pas : OKB le lit en entier, dans le
bon ordre, et te prépare sa **KB à lui**. Tu y trouves :

- une note pour comprendre le repo en 10 minutes ;
- les étapes pour le lancer ;
- l'architecture en schémas reliés au vrai code ;
- la carte « où modifier quoi » ;
- ses interfaces et la façon de le livrer ;
- la liste honnête de ce que personne n'a écrit, avec à qui le demander.

Ensuite, après chaque ticket, la KB du repo s'enrichit de ce que tu as appris.

Tu n'as besoin de rien savoir sur le repo. S'il existe des transcripts de
passation ou des docs, tu les donnes ; sinon OKB part du code et des README.

## Démarrer sur un repo

Dans Claude Code, ouvert dans le dossier du repo :

```text
/okb:onboard
```

Une phrase suffit aussi : « je découvre ce repo, aide-moi à démarrer ». OKB
propose de s'en charger avec un bouton.

Ce qui se passe :

1. **La KB du repo.** La première fois, OKB te demande où ranger ses notes. Il
   recommande une **KB de travail confidentielle**, qui reste sur cet ordinateur :
   - pas de GitHub ;
   - pas de lecture web ;
   - un avertissement si le dossier est dans iCloud ou OneDrive.

   Les notes de chaque repo vont dans `repos/<nom-du-repo>/`.
2. **Une seule question** : as-tu des transcripts ou des docs sur ce repo, ou le
   connais-tu déjà ? Si tu pars de zéro, réponds « non » : tout fonctionne quand même.
3. **La carte du repo.** En quelques secondes, sans IA et sans rien exécuter
   (`okb repo scan`), OKB relève :
   - la stack et les modules ;
   - ce que le repo expose (services, routes, événements) et ce qu'il appelle
     (destinations, API, bases, messagerie) ;
   - la configuration, les commandes et la CI ;
   - qui a modifié quoi ;
   - les endroits où la doc contredit le code.

   Tu apprends déjà l'essentiel dans la première minute.
4. **La lecture.** Claude lit d'abord toute la documentation. Des agents lisent
   ensuite chaque zone du code en parallèle. Puis Claude suit les 2 ou 3 flux
   principaux de bout en bout. Chaque fait trouvé est vérifié : la citation doit
   exister, mot pour mot, dans le fichier.
5. **Les 25 questions d'onboarding** :
   - à quoi il sert ;
   - qui l'appelle et qu'appelle-t-il ;
   - comment le lancer, le tester, le déployer ;
   - où modifier quoi, qui connaît le repo, quels pièges.

   Chacune finit avec une réponse citée ou marquée **inconnue**, avec où OKB a
   cherché et à qui demander.
6. **Les notes**, préparées en une seule proposition. Tu les relis (dans
   l'application web, c'est le plus confortable), puis tu approuves. Rien n'entre
   dans ta KB sans ton accord.

| Note | Pour quoi faire |
|---|---|
| 🎯 Comprendre en 10 minutes | expliquer le repo à un collègue après une seule lecture |
| ▶️ Démarrer | accès à demander, outils, commandes pour installer, lancer, tester, déboguer, et un parcours pour la première semaine |
| 🏗️ Architecture | contexte, modules, flux principaux (schémas de séquence), modèle de données, choix et zones sensibles |
| 🗺️ Carte du code | qui fait quoi, « pour changer X → tel fichier », conventions, personnes, pièges |
| 🔌 Interfaces | ce qu'il expose et ce qu'il appelle, avec la ligne qui le déclare |
| 🚀 Configurer, livrer, exploiter | variables (noms seulement), environnements, CI, déploiement, surveillance |
| ❓ Questions ouvertes | ce que la KB ne sait pas encore, où OKB a cherché, à qui demander |

Les termes métier deviennent des fiches concepts, partagées par tous les repos
de la KB.

## Ce qui rend ces notes fiables

- **Chaque affirmation pointe vers le code** : `srv/orders-service.js — l.17`.
  La note dit aussi à quel commit elle a été écrite.
- **Les schémas sont reliés au code.** Chaque boîte d'un schéma d'architecture
  correspond à un vrai fichier, un vrai dossier, ou à un système externe nommé ;
  OKB refuse une boîte qui ne pointe nulle part.
- **La doc n'est pas crue sur parole.** Si le README dit `npm run seed` et
  qu'aucun script `seed` n'existe, la note le signale au lieu de recopier la
  commande.
- **Les déductions sont marquées**, et une commande lue dans la doc reste
  « d'après le README » tant que personne ne l'a lancée.
- **Ce qui n'est pas connu reste visible.** Mieux vaut une question ouverte avec
  le bon interlocuteur qu'une phrase plausible et fausse.
- **Ce qui n'a pas été lu est dit** : fichiers lus en entier, parcourus, seulement
  repérés, ignorés (avec la raison).

## Répondre aux questions (toi, ou un senior)

```bash
okb repo questions
```

```bash
okb repo answer q-deploy "La prod est déployée par l'équipe plateforme, le jeudi" --by "Marie"
```

```bash
okb repo interview
```

- `okb repo questions` liste les questions, avec à qui demander.
- `okb repo answer` enregistre une réponse.
- `okb repo interview` est fait pour un collègue qui connaît le repo : il répond
  à tout, une question après l'autre.

Une réponse devient une **source datée** (« Réponse de Marie, 4 octobre ») que la
note peut citer. Au prochain `/okb:onboard`, Claude l'intègre dans la bonne note.
Dans l'application web, chaque question ouverte a un bouton « Répondre ».

## Commencer un ticket

```text
/okb:ticket je commence le ticket …
```

Claude garde le texte du ticket et cherche dans toute la KB ce qu'il touche, y
compris les autres repos et les notes générales. Il te donne :
- les notes à lire d'abord ;
- les fichiers qui vont sans doute changer ;
- les questions ouvertes que le ticket rencontre ;
- un plan court.

Il n'écrit rien : la note de ticket vient quand le travail est fini.

## Après un ticket

```text
/okb:ticket
```

Ou en clair : « j'ai fini mon ticket ». Claude te demande le texte du ticket,
puis lit les commits et les fichiers modifiés de la branche. Il voit aussi les
notes qui citent ces fichiers. Il prépare alors :

- une note de ticket : le besoin, ce qui a changé, comment c'est testé, ce qu'il
  faut retenir ;
- une section datée dans la **carte du code**, pour ce qui servira au prochain
  ticket : « pour changer X → tel fichier », un piège, une règle métier ;
- la mise à jour des notes dont le comportement décrit a changé.

`okb done` (fin de session) propose aussi `/okb:ticket` quand tu as travaillé
dans un repo documenté.

## Quand le code bouge

```bash
okb repo update
```

OKB recartographie le repo, puis classe chaque note :

| Statut | Ce que ça veut dire |
|---|---|
| **à jour** | rien de ce qu'elle cite n'a changé |
| **fichiers modifiés** | les citations sont toujours là |
| **dépassée** | une citation ou un fichier a disparu |

Il signale aussi les nouveautés : nouveau README, nouveau service, nouveau
manifeste. `/okb:onboard refresh` met les notes à jour.

## Dans Claude, au quotidien

Quand tu ouvres Claude dans un repo documenté, il sait :

- que la KB du repo existe et quelles notes elle contient ;
- combien de questions restent ouvertes ;
- quelles notes sont peut-être dépassées.

Il lit la bonne note avant de fouiller le code, et la cite. Dans un repo pas
encore documenté, il peut te proposer `/okb:onboard` si tu dis que tu le
découvres.

Les commandes `okb` lancées depuis un repo documenté visent automatiquement sa
KB : `okb status`, `okb ask`, `okb doctor`…

## Tous les repos d'une équipe : une KB de travail

Quand tu travailles sur beaucoup de repos qui se parlent, le plus simple est
**une seule KB de travail, avec une pièce par repo** :

```text
~/Documents/<tes repos>/        les repos, intacts : OKB n'y écrit rien
~/Documents/<ta KB>/            la KB de travail, confidentielle, sur cet ordinateur
  concepts/                    le vocabulaire métier et technique, une fiche par notion
  guides/                      l'application, ses fonctionnalités, l'architecture d'ensemble
  procedures/  tutos/          faire : poste de travail, déployer, débugger, accès
  decisions/  reunions/        pourquoi c'est ainsi ; démos, passations
  parcours/                    par où commencer sur un sujet
  repos/
    paysage.md                 qui appelle qui, d'après le code
    <repo>/                    la KB du repo : comprendre, démarrer, architecture,
                               interfaces, livrer, carte du code, questions ouvertes,
                               et une note par ticket
```

Pourquoi une seule KB plutôt qu'une par repo :
- **Les liens.** Une fonctionnalité traverse plusieurs repos : sa note générale
  pointe vers les interfaces de chacun. La recherche et le graphe voient tout.
- **Pas de doublons.** Une notion comme XSUAA a une seule fiche, utilisée par
  tous les repos.
- **Le paysage.** OKB calcule les connexions entre repos (services, événements,
  destinations), mais seulement entre les repos d'une même KB.
- **Ça se vit quand même comme une KB par repo.** Ouvre Claude Code dans un
  repo : OKB reconnaît le repo par son chemin et donne à Claude ses notes et ses
  questions ouvertes. `/okb:onboard` crée sa pièce, `/okb:ticket` la nourrit. Dans
  l'app web, la page Repos montre chaque repo, et le graphe se filtre par zone
  (`repos/<repo>`).
- **Rien dans les repos.** Aucun fichier n'est ajouté à tes repos : rien ne
  part par erreur dans un commit de l'équipe.

Une KB à part pour un repo n'a de sens que si sa confidentialité ou son public
diffère (`okb repo add --kb <autre>`).

**Mise en place**, une fois :

```bash
okb kb add ~/Documents/<ta KB>
```

```bash
okb repo add --all ~/Documents/<tes repos> --kb <ta KB>
```

```bash
okb repo landscape --propose --kb <ta KB>
```

1. `okb kb add` connecte la KB existante (ou `okb new` en crée une). Réponds
   « oui » à « KB confidentielle ».
2. `okb repo add --all` enregistre d'un coup chaque repo du dossier et en dresse
   la carte, sans IA, en quelques secondes par repo. Une KB rangée dans le même
   dossier n'est pas prise pour un repo.
3. `okb repo landscape --propose` prépare la note des connexions entre repos.
4. Si la KB date d'avant OKB, `/okb:convert` dans Claude Code : chaque note qui
   parle surtout d'un repo va dans `repos/<repo>/`, le reste dans les dossiers
   généraux.
5. Ensuite, repo par repo, au moment où tu en as besoin : `/okb:onboard` la
   première fois, puis `/okb:ticket` au début et à la fin de chaque ticket.

## Plusieurs repos

```bash
okb repo landscape
```

Montre comment les repos d'une même KB se relient, d'après leurs déclarations :

- une API déclarée par l'un et appelée par l'autre ;
- une bibliothèque publiée et utilisée ;
- un événement émis et écouté.

`--propose` en fait une note avec un schéma.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `okb repo add` | enregistre le repo du dossier courant dans une KB (demande laquelle) et le cartographie |
| `okb repo scan` | refait la carte |
| `okb repo status` | notes, couverture, questions, fraîcheur, prochaine étape |
| `okb repo plan` | le plan de lecture, zone par zone |
| `okb repo questions` · `answer` · `interview` | les questions d'onboarding et leurs réponses |
| `okb repo update` | ce qui a changé depuis l'écriture des notes |
| `okb repo ticket` | le contexte d'une branche terminée (utilisé par `/okb:ticket`) |
| `okb repo landscape` | les liens entre les repos d'une KB |
| `okb repo list` · `remove` | les repos suivis ; arrêter d'en suivre un (ses notes restent) |

Dans l'application web (`okb serve`), la page **Repos** montre tout cela. On y
répond aux questions en un clic.

## Limites, honnêtement

- OKB lit le code, il ne l'exécute pas : une note dit ce que le code **déclare**,
  pas ce qui se passe en production.
- La cartographie reconnaît beaucoup de choses :
  - SAP : CAP, MTA, UI5/Fiori, approuter, XSUAA, ABAP/RAP ;
  - frameworks : Node, Java/Spring, Python, Go, .NET ;
  - déploiement : Docker, Kubernetes, CI.

  Le reste est lu comme du code ordinaire.
- Sur un très gros repo, la première lecture se fait en plusieurs sessions :
  l'avancement est gardé, `/okb:onboard` reprend où il s'était arrêté.
- Aucune valeur secrète n'est jamais copiée : seulement les noms de variables.
