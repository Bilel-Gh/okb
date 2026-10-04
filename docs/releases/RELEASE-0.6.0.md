# Version 0.6.0

Cette version donne à **chaque repo de code** sa propre base de connaissances.
Elle s'adresse à quelqu'un qui arrive sur un repo sans rien en savoir : OKB
l'aide à y travailler vite, puis continue d'apprendre avec lui ticket après
ticket.

## S'onboarder sur un repo

- **`/okb:onboard`** dans Claude Code, ou en clair « je découvre ce repo ».
  1. Une carte du repo en quelques secondes.
  2. Une lecture complète par ordre de priorité, avec des agents qui lisent
     chaque zone en parallèle.
  3. Les 25 questions d'onboarding.
  4. Sept notes préparées en une seule proposition :
     - comprendre en 10 minutes ;
     - démarrer ;
     - architecture ;
     - carte du code ;
     - interfaces ;
     - configurer, livrer, exploiter ;
     - questions ouvertes.
- **`okb repo scan`** dresse la carte sans IA et sans rien exécuter :
  - stack et modules ;
  - ce que le repo expose et ce qu'il appelle (services CDS, routes, événements,
    destinations, bindings MTA, data sources UI5, URL, bases, messagerie) ;
  - variables (noms seulement), environnements, commandes, CI, tests ;
  - propriétaires (CODEOWNERS, historique Git), fichiers centraux et très modifiés ;
  - vocabulaire métier, risques ;
  - commandes du README qui n'existent pas.

  Sont reconnus en particulier :
  - SAP : CAP, MTA, UI5/Fiori, approuter, XSUAA, ABAP/RAP, Cloud SDK ;
  - frameworks : Node, Java/Spring, Python, Go, .NET ;
  - déploiement : Docker, Kubernetes, CI.
- **Un plan de lecture** : fichiers à lire en entier, à parcourir, à indexer,
  ignorés (toujours avec la raison). La couverture est mesurée et affichée.
- **Dossier version 3** : une affirmation cite `fichier` + `lignes` + citation
  exacte. OKB vérifie chaque citation contre le fichier actuel et trouve ses
  lignes.
- **Schémas ancrés** : chaque boîte d'un schéma Mermaid pointe vers un vrai
  chemin du repo ou vers un système externe nommé.
- **Personne ne doit répondre pour que ça marche** : une question sans réponse
  dans le repo reste visible, avec où OKB a cherché et à qui demander
  (CODEOWNERS, historique Git). Un senior peut répondre à tout moment
  (`okb repo answer`, `okb repo interview`, bouton « Répondre » dans l'appli web) ;
  sa réponse devient une source datée.

## Dans la durée

- **`/okb:ticket`** (« j'ai fini mon ticket ») prépare une note de ticket et des
  entrées « pour changer X → tel fichier » et pièges dans la carte du code, puis
  met à jour les notes concernées. Il s'appuie sur la branche, les commits, le
  texte du ticket et le code final.
- **`okb repo update`** dit quelles notes le code a rendues dépassées (citation
  ou fichier disparu), lesquelles citent des fichiers modifiés, et ce qui est
  nouveau.
- **`okb repo landscape`** relie les repos d'une même KB : API déclarée d'un
  côté et appelée de l'autre, bibliothèque publiée puis utilisée, événement émis
  puis écouté.
- **Au démarrage de Claude dans un repo documenté**, Claude sait où sont ses
  notes et les lit avant de fouiller le code.
- Les commandes `okb` lancées depuis un repo documenté visent sa KB.

## Confidentialité

- **KB de travail confidentielle** (`kb.confidential`), proposée par défaut pour
  le code d'entreprise :
  - pas de lecture web, pas de dépôt GitHub créé par OKB ;
  - `okb doctor` prévient si le dossier est synchronisé (iCloud, OneDrive,
    Dropbox…) ou si la KB a un remote Git.
- Rien n'est jamais écrit dans le repo de l'entreprise. Les fichiers de
  configuration sensibles (`.env`, `default-env.json`) ne sont jamais lus au-delà
  des noms de variables.

## Interfaces

- **Terminal** : `okb repo` (`add`, `scan`, `status`, `plan`, `questions`,
  `answer`, `interview`, `update`, `ticket`, `landscape`, `list`, `remove`) ;
  entrée dans le menu `okb` ; contrôle « Repos documentés » et
  « Confidentialité » dans `okb doctor`.
- **Application web** : page **Repos**, avec pour chaque repo :
  - les notes et l'avancement ;
  - les questions, avec réponse en un clic ;
  - la carte et la fraîcheur ;
  - le paysage multi-repos.
- **Plugin** :
  - skills `okb-onboard` et `okb-repo-learn` ;
  - agent `okb-repo-explorer` ;
  - commandes `/okb:onboard`, `/okb:ticket`, `/okb:repo` ;
  - intentions « je découvre ce repo » et « j'ai fini mon ticket » ;
  - `/okb:done` propose `/okb:ticket`.
- **Sept modèles de notes** : `repo-overview`, `repo-start`, `repo-architecture`,
  `repo-interfaces`, `repo-delivery`, `repo-codemap`, `repo-ticket`.

## Le graphe et les catégories

- **Neuf catégories de notes**, chacune avec sa couleur et son emoji, partout :
  graphe, liste des notes (pastilles et filtre), lecture, recherche, relecture
  des propositions, page d'accueil, terminal (`okb status`, `okb categories`,
  `okb template list` groupé).
- La catégorie vient du modèle de la note, de son type ou de son dossier. Rien
  n'est écrit dans les notes. Pour en changer, `okb categories set <note>
  <catégorie>` ou la pastille de la note dans l'appli web prépare une
  proposition.
- **Trois nouveaux modèles** : `tutorial` (tuto), `client-case` (cas client),
  `path` (parcours).
- Catégories propres à une KB dans `.okb/categories.yaml`.
  `okb maintain` signale les notes sans catégorie.
- **Graphe** dans l'application web (page Graphe) :
  - notes et liens, couleur par catégorie, taille selon les liens ;
  - zoom, déplacement, voisinage d'une note, filtres par catégorie et par zone ;
  - regroupement, recherche.
- **Graphe local** sous chaque note, avec les rétroliens et les liens sortants
  exacts.
- **Page Catégories** : ce qu'on range dans chacune, ses modèles, les notes sans
  catégorie.

## Vérification

Voir le tableau de [DECISIONS.md](../dev/DECISIONS.md) (D28). Tests sur un repo
SAP CAP fictif (`tests/fixtures/repos/orders-service`) : carte, plan, dossier v3,
schémas ancrés, notes, fraîcheur, trouvailles, réponses, ticket, paysage, CLI,
intentions.
