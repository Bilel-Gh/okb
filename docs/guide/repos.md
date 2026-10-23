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

Dans l’application, **Projets** montre le travail à accomplir, tandis que
**Projets › Repos** donne accès au contexte technique. Ouvre un repo pour
retrouver d’abord ses notes, ses tickets et la fraîcheur de leurs sources.
L’absence de source liée laisse cette fraîcheur inconnue. La couverture de
lecture, les questions et la carte technique restent derrière des accès
repliables. Les aperçus de tickets affichent une suite ou un blocage court ;
leur journal et les informations complètes sont dans la fiche spécialisée.

Tu n'as besoin de rien savoir sur le repo. S'il existe des transcripts de
passation ou des docs, tu les donnes ; sinon OKB part du code et des README.

## Démarrer sur un repo

Dans Claude Code, ouvert dans le dossier du repo :

```text
/okb-dev:onboard
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
okb repo answer q-deploy "La prod est déployée par l'équipe plateforme, le jeudi" --by "dev senior"
```

```bash
okb repo interview
```

- `okb repo questions` liste les questions, avec à qui demander.
- `okb repo answer` enregistre une réponse.
- `okb repo interview` est fait pour un collègue qui connaît le repo : il répond
  à tout, une question après l'autre.

Une réponse devient une **source datée** (« Réponse du dev senior, 4 octobre ») que la
note peut citer. Au prochain `/okb-dev:onboard`, Claude l'intègre dans la bonne note.
Dans l'application web, chaque question ouverte a un bouton « Répondre ».

## Commencer un ticket

```text
/okb-dev:ticket je commence le ticket ABC-123 …
```

OKB suit désormais le ticket : son point de départ, sa branche, ses commits, et
un journal des décisions et des pièges que Claude y note en une ligne. Tout cela
sans IA et sans rien écrire dans la KB.

Claude cherche dans la KB ce que le ticket touche (ce repo d'abord, puis les
notes communes et les autres repos) et te donne :
- les notes à lire d'abord ;
- les fichiers qui vont sans doute changer ;
- les questions ouvertes que le ticket rencontre ;
- un plan court.

## Après un ticket

```text
/okb-dev:ticket
```

Ou en clair : « j'ai fini mon ticket ». Claude rassemble le texte du ticket, ses
commits (même fusionnés en un seul), son journal et les fichiers modifiés. Il
voit aussi les notes qui citent ces fichiers. Il prépare alors :

- une note de ticket : le besoin, ce qui a changé, comment c'est testé, ce qu'il
  faut retenir ;
- une section datée dans la **carte du code**, pour ce qui servira au prochain
  ticket : « pour changer X → tel fichier », un piège, une règle métier ;
- la mise à jour des notes dont le comportement décrit a changé ;
- dans la partie commune de la KB, ce qui dépasse ce repo : une règle métier,
  un nouveau terme, une fonctionnalité qui traverse plusieurs repos.

`okb done` (fin de session) propose aussi `/okb-dev:ticket` quand tu as travaillé
dans un repo documenté. Le détail : [Un ticket, du début à la fin](espace-de-travail.md#un-ticket-du-début-à-la-fin).

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
manifeste. `/okb-dev:onboard refresh` met les notes à jour.

## Dans Claude, au quotidien

Quand tu ouvres Claude dans un repo documenté, il reçoit un court brief :

- les notes du repo, dans l'ordre de lecture ;
- les notes communes liées au repo (métier, fonctionnalités) ;
- les repos avec lesquels il communique ;
- le ticket en cours, avec ses commits et son journal.

Il lit la bonne note avant de fouiller le code, et la cite. Dans un repo pas
encore documenté, il peut te proposer `/okb-dev:onboard` si tu dis que tu le
découvres.

Les commandes `okb` lancées depuis un repo documenté visent automatiquement sa
KB : `okb status`, `okb ask`, `okb doctor`…

## Tous les repos d'une équipe

Si tes repos sont rangés dans un même dossier, fais-en un **espace de travail** :
une seule KB, un espace par repo, et OKB se concentre tout seul sur le repo et le
ticket dont tu parles. Un repo isolé a plutôt sa **KB de repo**, dont il est le
seul sujet : [Choisir son organisation](choisir-son-organisation.md).

```bash
okb workspace add ~/dev/mon-equipe
```

→ [Plusieurs repos : l'espace de travail](espace-de-travail.md)

## Plusieurs repos

```bash
okb repo landscape
```

Montre comment les repos d'une même KB se relient, d'après leurs déclarations :

- une API déclarée par l'un et appelée par l'autre ;
- une bibliothèque publiée et utilisée ;
- un événement émis et écouté.

`--propose` en fait une note avec un schéma.

### Une carte qui dit vrai

Une adresse écrite dans le code n'est pas forcément une relation. OKB range
chaque adresse selon l'endroit où elle est écrite :

- **sur la carte** : un appel dans le code (ressource externe *déclarée*), une
  adresse sous une clé de configuration (*supposée*) ;
- **pas sur la carte** : un registre de paquets (Nexus, jcenter…),
  l'hébergement du code (GitHub interne), un lien de documentation (wiki, Jira,
  un commentaire), une police ou un CDN, la plateforme (Eureka, Sonar…), et les
  adresses qu'OKB ne sait pas classer.

Chaque relation dit sa **certitude** — prouvée, déclarée, supposée ou confirmée
— et **pourquoi** OKB la dessine. Si c'est faux, corrige-la : dans l'onglet
Architecture (Confirmer, Corriger la cible, Exclure) ou dans le terminal.
Les prochains scans respectent ta correction.

```bash
okb arch link list
okb arch link exclude "service|repo:facturation|repo:commandes" --reason "ancien flux"
okb arch link retarget "service|repo:facturation|repo:commandes" repo:stocks
okb arch url nexus.example.test registry
```

### L'équipe responsable

Chaque repo et chaque produit peut avoir son **équipe responsable**, avec
d'où vient l'information (toi, l'agent, Jira, ServiceNow, le wiki…) et quand.
Un repo sans équipe montre celle de son produit. Si `CODEOWNERS` cite une
équipe, OKB te la propose sans la remplir. Ta valeur n'est jamais écrasée : si
une source dit autre chose, tu choisis.

```bash
okb team repo commandes
okb team set product Commerce --value "Équipe Commerce"
okb team ask repo commandes
```

`okb team ask` crée une demande que ton agent voit au début de sa session : il
cherche avec ses propres outils (ServiceNow, Jira, wiki) et dit ce qu'il n'a
pas pu lire. OKB ne contacte aucune source lui-même.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `okb repo add` | enregistre le repo du dossier courant dans une KB (demande laquelle) et le cartographie |
| `okb repo scan` | refait la carte |
| `okb arch link …` | confirme, exclut, recible ou ajoute une relation de la carte |
| `okb team …` | l'équipe responsable d'un repo ou d'un produit |
| `okb repo status` | notes, couverture, questions, fraîcheur, prochaine étape |
| `okb repo plan` | le plan de lecture, zone par zone |
| `okb repo questions` · `answer` · `interview` | les questions d'onboarding et leurs réponses |
| `okb repo update` | ce qui a changé depuis l'écriture des notes |
| `okb repo ticket` | le contexte d'une branche terminée, sans ticket suivi |
| `okb workspace` · `okb scope` · `okb ticket` | l'espace de travail, le périmètre, le suivi des tickets : [voir le guide](espace-de-travail.md#les-commandes) |
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
  l'avancement est gardé, `/okb-dev:onboard` reprend où il s'était arrêté.
- Aucune valeur secrète n'est jamais copiée : seulement les noms de variables.
