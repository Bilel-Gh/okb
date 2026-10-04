# Version 0.7.0

Cette version t'aide à **t'y retrouver** quand la KB grandit (graphe, catégories,
thèmes) et à **savoir ce que coûte OKB** et si son travail te convient, pour
l'améliorer au fil de l'usage.

## Utilisation, coûts et rapport

- **`okb usage`** et la page **Utilisation** de l'application web : ce que coûte
  chaque tâche OKB (import, onboarding, question…), par modèle, par sous-agent et
  par KB. Le coût par jour, la part d'OKB dans ton usage de Claude Code, la part
  lue depuis le cache.
- Tout est lu dans les journaux que **Claude Code garde déjà** sur ton
  ordinateur : afficher ces chiffres ne dépense **aucun token**. Le coût est un
  équivalent API (prix publics datés), pour comparer.
- **Ce qui remplit le contexte** : instructions des skills, sorties des commandes
  `okb`, contexte de début de session.
- **Qualité**, lue dans tes propositions :
  - les propositions appliquées ;
  - les changements écartés à la relecture (par type) ;
  - le délai de relecture ;
  - les notes **retouchées à la main** après application.
- **Commandes** : une ligne par commande `okb` (jamais ses arguments) ; les échecs
  par code d'erreur et les durées.
- **`okb feedback "…"`**, « note un retour sur OKB » dans Claude, ou le cadre de
  la page Utilisation : tes remarques, au moment où tu les vis.
- **`okb report`** : tout cela en une page Markdown, sans le texte de tes notes, à
  donner à Claude pour améliorer OKB.
- **Pistes d'amélioration** tirées des chiffres :
  - un sous-agent trop cher ;
  - une sortie trop longue ;
  - un cache peu utilisé ;
  - une tâche anormalement chère ;
  - trop de changements écartés ou de notes retouchées ;
  - des propositions qui attendent.

## Moins de tokens, même rédaction

- Les commandes `okb … --json` répondent en JSON compact quand c'est Claude (ou un
  programme) qui lit : les mêmes données en 25 à 40 % de tokens en moins. Dans
  un terminal, le JSON reste indenté.
- Un banc d'essai (`scripts/bench.mjs`) lance un vrai import ou un vrai
  onboarding dans un bac à sable, sur des sources fictives aux faits connus, et
  note le coût et la qualité (faits retrouvés, erreurs, jugement à l'aveugle de
  la rédaction). Méthode et mesures : [COSTS.md](../dev/COSTS.md).

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
  - **thèmes détectés** automatiquement (méthode de Louvain), avec un halo et un
    nom chacun : celui du guide qui explique le thème, sinon du tag que ses notes
    partagent. La liste des thèmes montre les notes de chacun ; disposition en deux
    niveaux, calculée avant l'affichage ;
  - titres placés sans chevauchement ;
  - notes et liens, couleur par catégorie, taille selon les liens ;
  - zoom, déplacement, voisinage d'une note, filtres par catégorie et par zone ;
  - regroupement, recherche.
- **Graphe local** sous chaque note, avec les rétroliens et les liens sortants
  exacts.
- **Page Catégories** : ce qu'on range dans chacune, ses modèles, les notes sans
  catégorie.

## Application web après une mise à jour

- Une application web lancée avant une mise à jour garde la page qui correspond
  à son code. Elle affiche un bandeau qui invite à relancer `okb serve`.
- Un nouveau `okb serve` arrête l'ancienne version quand il le peut. Sinon, il
  s'ouvre à côté et explique quoi faire.
- `okb update` prévient quand l'application tourne encore avec l'ancienne
  version.

## Vérification

`npm run release:check` : tests du lecteur de journaux (une réponse comptée une
fois, sessions reprises, sous-agents rattachés à leur tâche, développement
d'OKB exclu), prix, statistiques, signaux de qualité, journal des commandes sans
arguments, rapport sans texte de note, intentions « combien coûte OKB » et
« note un retour ».
