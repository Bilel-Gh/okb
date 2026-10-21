# Lot E — Valider en un geste

Spec validée en conversation le 20 octobre 2026, avec les maquettes de référence
(`maquettes-lot-e/`, hors dépôt). Identifiants proposés : F2.0-52 à F2.0-57, à
reporter dans la feuille de route. Décision associée : D71, qui amende D25
(approbation par présence humaine) et la règle « aucune écriture dans la KB sans
le oui de la personne ».

## Pourquoi

En usage réel, enregistrer une note demande trop de gestes : une carte de
suggestion alors que la personne vient de demander la note, une préparation parfois
longue (relecture), puis une approbation qui exige une fenêtre système ou une
commande dans le terminal. En pleine action, la personne ne veut pas être bloquée ;
elle veut trier ses notes au calme, en fin de journée.

## Ce qui est décidé

- **L’agent range directement les nouvelles notes**, marquées « à relire ».
  Elles sont utilisables et cherchables tout de suite.
- **Une note à relire** se modifie directement par l’agent ; elle reste à relire.
- **Une note validée** (la personne a dit oui, ou c’est son texte) ne change
  qu’après son oui : la modification attend, comme différence avant/après.
- **La personne trie au calme** dans un écran « À relire » : Oui, Non, Changer
  l’emplacement, Faire relire ; « Oui à tout, sauf… ».
- **La place** de chaque note est montrée avant le oui, avec sa raison, et se
  change dans l’arbre de la mémoire ; les liens suivent.
- **La relecture** (confronter les faits aux sources) est une option : l’agent la
  propose en une ligne à la fin d’une note ; la personne peut la demander plus tard.
- **Trois états visibles**, toujours couleur et mot : À relire (orange), Validée
  (vert), Validée et vérifiée (vert plein) ; « Modification en attente » (bleu)
  pour une modification d’une note validée.
- **Le pourcentage de notes validées** est un indicateur de la santé de la KB.
  Sur l’accueil, il reste discret : une ligne sous la date et la barre d’état.
- **Notes existantes** : validées si elles sont passées par une proposition
  approuvée par la personne ou si elle les a écrites elle-même ; à relire si elles
  ont été générées sans trace d’approbation.
- **Un réglage par KB**, que seule la personne change : « L’agent range
  directement, je relis après » (choisi pour ses KB) ou « Rien n’entre sans mon
  oui » (par défaut, et conseillé pour une KB partagée). Avec le second, rien ne
  change par rapport à aujourd’hui, sauf l’approbation sans fenêtre système.

## Le modèle

### Le réglage (F2.0-52)

`changes.agentWrites: 'proposal' | 'review-later'`, défaut `proposal`. Seule la
personne le change (réglages de l’app ou `okb settings`) ; une opération appelée
par un agent ne peut pas le modifier, et le hook `guard-approval` refuse aussi
une écriture directe du profil par un outil. `changes.apply: allow-direct` garde
son sens actuel et reste indépendant.

Les options de relecture vivent au même endroit :
`review.offer: true` (proposer une relecture à la fin d’une note) et
`review.auto: 'never' | 'risky'` (relire d’office les notes longues ou qui
contredisent une note validée), défaut `never`.

### L’état de relecture d’une note (F2.0-53)

Il est gardé dans l’état SQLite, pas dans les notes : aucune réécriture en masse
de la KB.

`note_reviews(path, note_id, state, by, at, sha256, reason, receipt_id)` où
`state` vaut `pending` (à relire) ou `validated`. `note_id` est l’`id` OKF de la
note quand elle en a un : un déplacement fait suivre l’état. `reason` est la phrase
qui dit pourquoi l’agent l’a rangée là. `receipt_id` relie la note au reçu
d’application qui l’a créée ou modifiée en dernier.

« Vérifiée » ne crée pas d’état : c’est la vérification OKF existante
(`verified`, tiers `machine-confirmed` ou `human-reviewed`). « Validée et
vérifiée » = `validated` et un tiers autre que `unverified`.

Une note sans ligne `note_reviews` est classée une fois (migration) :
- `validated` si un reçu d’application approuvé par un humain la contient, ou si
  elle n’a pas de champ `generated` (texte de la personne) ;
- `pending` si elle a un champ `generated` et aucun reçu approuvé par un humain.
Les notes réservées (index, navigation) ne comptent pas.

Une note validée modifiée hors OKB (dans Obsidian, par la personne) reste validée :
le `sha256` sert seulement à dire « modifiée depuis ta validation » dans le lecteur.

### Le chemin d’écriture de l’agent (F2.0-54)

L’agent prépare toujours une proposition (le moteur, ses gardes et ses reçus ne
changent pas). Avec `review-later` :

- une proposition dont toutes les modifications **créent** une note, ou modifient
  une note `pending`, est **appliquée aussitôt**, avec l’approbation
  `policy:review-later`, et chaque note touchée devient `pending` avec sa raison ;
- une modification d’une note `validated` reste une proposition `prepared`,
  listée dans « À relire » comme « Modification en attente » ;
- une proposition mixte est séparée : la partie directe est appliquée, la partie
  qui touche des notes validées attend ;
- les gardes existantes s’appliquent toujours : chemins autorisés, aucun secret,
  notes confidentielles, nombre maximal de fichiers. Une proposition refusée par
  une garde n’est pas appliquée.

Quand la personne **demande** une note (« garde ça », « fais une note sur… »), sa
demande vaut accord : pas de carte de suggestion. La carte reste quand l’agent
propose de lui-même une note.

### Les gestes de la personne (F2.0-55)

Opérations du moteur, réservées à la personne (`agents: false`) :
- `notes.review.list` (lecture, ouverte aux agents) : notes `pending` et
  modifications en attente, la plus ancienne d’abord, groupées par jour ;
- `notes.review.validate { paths }` : `pending` → `validated` (par la personne) ;
- `notes.review.reject { path }` : pour une note créée par l’agent, une
  suppression de cette seule note, appliquée par le moteur avec l’approbation de
  la personne (corbeille et reçu gardés ; les autres notes du même reçu ne bougent
  pas) ; pour une note `pending` modifiée par l’agent, retour à son texte d’avant ;
  pour une modification en attente, la proposition est écartée ;
- `notes.review.move { path, folder }` : déplacement avec réparation des liens
  (`planMove`), l’état suit la note ;
- `notes.review.approveChange { proposalId }` : applique une modification en
  attente sur une note validée ; la note reste validée ;
- `notes.review.yesToAll { except }` : « Oui à tout, sauf… » ;
- `notes.review.requestCheck { path }` : demande de relecture pour la prochaine
  session de l’agent (même mécanique que les demandes du lot A, généralisée aux
  notes : `note_requests`).

### L’approbation dans l’app, sans terminal ni fenêtre (F2.0-56)

`okb serve` crée une clé de session aléatoire et ouvre le navigateur avec un lien
à usage unique qui la dépose dans un cookie `HttpOnly`, `SameSite=Strict`, propre
au port. Les opérations de la personne (`notes.review.*` en écriture,
`/api/proposal/approve`, `/api/evening/yes`) exigent ce cookie et une origine
locale. Sans cookie (autre navigateur, lien tapé à la main), l’app retombe sur la
confirmation actuelle (fenêtre sur Mac, terminal ailleurs). La clé n’est ni écrite
sur disque, ni affichée dans le terminal, ni passée en argument d’un processus
visible ; le lien affiché dans le terminal est le lien simple, sans clé.

Le hook `guard-approval` continue de refuser l’approbation lancée par un outil :
commandes d’approbation, appels HTTP vers les routes d’approbation et de relecture,
lecture de la clé d’approbation. Limite honnête : cela protège d’un agent qui
appelle l’API, pas d’un logiciel qui pilote la souris de la personne.

### L’indicateur (F2.0-57)

`validatedShare = validées / notes non réservées`, et sa décomposition (validées,
dont vérifiées ; à relire). Il apparaît :
- dans les Indicateurs (détail, évolution sur 30 jours) ;
- sur l’accueil, une seule ligne sous la date : « ● N notes à relire · mémoire
  validée à X % » (rien d’autre ; « mémoire validée à 100 % » quand tout est trié) ;
- dans la barre d’état : « N à relire · X % validées ».

## Interface

Maquettes de référence : À relire (nouvelle note, modification), Changer
l’emplacement, Note dans le lecteur, Accueil, Dans Claude, Réglage, Tout est trié.

- **À relire** (dans « À valider ») : liste groupée par jour, type de note en
  couleur, « nouvelle » ou « modification », place et heure ; avancement du tri du
  jour ; filtres Tout, Nouvelles, Modifications ; « Oui à tout, sauf… ». Le détail
  montre la note rendue, sa place et sa raison, puis Oui, Non, Faire relire ; une
  modification montre la différence avant/après avec Oui, appliquer · Non, garder
  ma version · Modifier avant. Clavier : O, N, ← →.
- **Changer l’emplacement** : arbre de la mémoire avec recherche, dossier proposé
  par l’agent et choix de la personne, nombre de liens mis à jour, Ranger ici.
- **Lecteur** : une note à relire porte une fine ligne avec Oui, Non, Déplacer.
  Les listes de notes montrent la pastille d’état.
- **Accueil** : la ligne discrète et la barre d’état décrites plus haut.
- **Tout est trié** : bilan du tri du jour et nouveau pourcentage.
- **Réglages** : « Écriture par l’agent » (deux choix) et les deux options de
  relecture.

Thème Atelier, français et anglais, mode sombre ; couleur toujours doublée d’un
mot ; actions atteignables au clavier.

## Côté agent (skills et brief)

- `okb-capture` et `okb-ingest` : une note demandée par la personne est préparée
  sans carte de suggestion ; avec `review-later`, l’agent annonce en une ligne
  « Note rangée, déjà utilisable : <titre> · <place> · Ouvrir dans OKB », puis
  propose la relecture si `review.offer`. Aucune commande à taper.
- Le brief de début de session indique le nombre de notes à relire et les
  relectures demandées, comme les demandes du lot A.
- L’agent ne valide jamais une note, n’écarte jamais une modification et ne change
  jamais le réglage.

## Hors du lot E

La refonte de « Ce qui s’est passé » (lot C) ; la suggestion de todos (lot B) ;
une validation par un tiers dans une KB partagée.

## Tests (écrits avant le code)

- Réglage : défaut `proposal` inchangé ; un agent ne peut pas passer en
  `review-later`.
- Écriture : création appliquée et `pending` ; modification d’une note `pending`
  appliquée ; modification d’une note `validated` laissée en attente ; proposition
  mixte séparée ; garde de secret ou de chemin qui refuse ; reçu présent.
- Gestes : valider, Non sur une création (la note disparaît, l’historique reste),
  Non sur une modification, déplacer avec liens, Oui à tout sauf, demande de
  relecture.
- Migration : notes approuvées, notes de la personne, notes générées sans reçu ;
  deux lancements donnent le même résultat ; aucune note n’est réécrite.
- Approbation web : avec cookie, sans fenêtre ; sans cookie, repli sur la
  confirmation ; un appel HTTP sans cookie est refusé ; hook qui refuse les routes.
- Indicateur : 0, 50 et 100 % ; notes réservées exclues.
- Parcours Chromium : trier une journée (Oui, Non, Déplacer, Oui à tout sauf),
  modification d’une note validée, accueil et barre d’état, mode sombre.

## Validation par la personne

Sur son Mac, avec `okb serve` : demander une note à l’agent, la voir rangée sans
aucun geste, puis le soir la trier dans « À relire » sans terminal ni fenêtre
système, et voir le pourcentage évoluer.
