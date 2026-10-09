# L’application web

```bash
okb serve
```

La page s’ouvre dans ton navigateur (`http://127.0.0.1:4317`). Elle ne tourne que
sur ton ordinateur : aucun compte, aucun service en ligne. Arrête-la avec Ctrl+C
dans le terminal. Autre port : `okb serve --port 4318` ; sans ouvrir le
navigateur : `okb serve --no-open`.

![Aujourd’hui, thème Atelier](../images/web-home.png)

## Les destinations

La barre de gauche montre ton cerveau d’abord, puis OKB. Chaque destination a ses
onglets, chacun avec son adresse (on peut la garder en favori).

| Mon cerveau | Pour |
|---|---|
| **Aujourd’hui** | l’accueil : ce qui attend ton oui, reprendre une note, ce qui est utile maintenant, ta progression, réviser, capturer une idée, ton cerveau par type et par tiroir. Onglets **Focus et journal** (ta note de focus, finir une session, le journal) et **Revue de la semaine** (pas à pas) |
| **Cerveau** | l’explorateur, en trois colonnes : à gauche tes notes **épinglées**, les **récentes**, tes **vues**, puis l’arbre de tes dossiers, **dépliable niveau par niveau**, ou tes **types de notes** (chaque type se déplie par tiroir) ; au milieu la liste, **groupée par type ou par dossier**, chaque groupe repliable ; à droite la note, ou la page du dossier choisi (sa page de 5 minutes, ses sous-dossiers, ses notes par type). Détails plus bas |
| **Graphe** | toutes les notes et leurs liens, regroupées par thème, par type ou par dossier ; ou le cerveau **vu d’en haut**, tiroir par tiroir ([détails](graphe-et-categories.md)) |
| **Demander** | une question : les passages de tes notes qui répondent ; sur ton clic, une réponse rédigée qui cite chaque passage |
| **À valider** | **Suggestions** de Claude (Accepter, Plus tard, Non merci), **Propositions** à relire, **Captures** à trier, **Historique** des changements (annuler le dernier) |
| **Repos** | le **niveau de connaissance** de chaque repo, l’**architecture** calculée depuis le code (zoom, clic sur une ligne pour sa preuve), et la **fiche d’un repo** : ses notes, ses questions d’onboarding par thème (réponds en ligne), son **examen de connaissance**, sa carte, ses tickets, la fraîcheur de ses notes |
| **Apprendre** | **Réviser** les cartes (Révéler, puis 1 à 4), ta **Progression** (niveau et badges), ta **Carrière** |

| OKB | Pour |
|---|---|
| **Outils** | ajouter une source, transformer une procédure en skill, les modèles et ton style, les catégories, **Partager** (un pack pour un collègue, ou recevoir le sien) |
| **Entretien** | la santé du cerveau, les sauvegardes, l’utilisation (coûts, qualité), le diagnostic et la mise à jour |
| **Modules**, **Claude Code** | les modules par métier ; installer OKB dans Claude Code en un clic |
| **Réglages** | les réglages, l’apparence, tes cerveaux (ouvrir, connecter un dossier, en créer un) |
| **Aide** | la visite guidée, le glossaire, les raccourcis, les codes d’erreur |

**⌘K** (ou `/`) cherche une note par quelques mots, fautes et accents pardonnés, ou
t’emmène sur n’importe quelle page ou onglet. Les anciennes adresses (`#/weekly`,
`#/health`, `#/kbs`…) ouvrent la bonne page.

![Cerveau : l’arbre des dossiers, la liste groupée par type et une note, thème Atelier](../images/web-atelier.png)

### Trouver une note

- **Filtres** (au-dessus de la liste) : un ou plusieurs types, le statut
  (brouillon, validée, dépassée), la qualité (bonnes ★4 et plus, faibles ★2 et
  moins), la date (7 jours, 30 jours, un an), 🔒 seules ou sans 🔒. Ils se
  cumulent ; chacun s’enlève d’un clic.
- **Affichage** : en **liste**, en **tableau** (type, emplacement, qualité, date)
  ou en **cartes** ; grouper par type, par dossier ou pas ; trier par titre, les
  plus récentes ou les meilleures d’abord.
- **Enregistrer la vue** garde le dossier, les filtres et l’ordre sous un nom ;
  trois vues sont prêtes : Brouillons, Notes faibles, Modifiées cette semaine.
- **Épingler** une note (bouton punaise sur la note) la garde en haut de l’arbre,
  avec les notes ouvertes récemment.
- En tableau ou en cartes, coche plusieurs notes : **changer leur type** ou les
  **rendre 🔒** en une seule proposition, ou **copier leurs liens**.
- Au clavier : **↑ ↓** dans la liste, **Échap** vide la sélection puis ferme la note.

### Lire une note

Le chemin de la note en haut (chaque étape mène à son dossier), son titre et son
résumé, puis son type (clique pour le changer : une proposition est préparée), son
état, ses sources et sa qualité. Les mots qui ont une fiche concept sont soulignés
en pointillé : laisse la souris dessus un instant (ou touche-le sur un téléphone),
une bulle montre la phrase de la fiche et « Lire la fiche → ». En bas : les notes
qui la citent et celles qu’elle cite, et son graphe local. La punaise l’épingle ; le
menu « … » donne ses versions, l’ouverture dans Obsidian et son chemin.

![Lire une note](../images/web-note.png)

### Choisir son apparence

Le menu **Apparence** (en haut à droite, dans Réglages, ou ⌘K) :

- **le thème** : **Atelier** (par défaut), violet, barre latérale sombre et barre
  d’état ; ou **Classique**, vert et clair, l’interface des premières versions ;
- **clair** (par défaut), **sombre** ou **auto** (comme ton système) ;
- **le style** : **dégradé** (par défaut) ou **à plat**, pour tout le site, logo compris ;
- **le logo** : chacune des propositions de logo.

Une seule police partout, Inter ; le code seul est en police à chasse fixe. La
barre de gauche se **replie** en icônes ou se **déplie** avec les textes : le
bouton en haut de la barre, ou **⌘\\** (Ctrl+\\). Tes choix sont retenus par ton
navigateur.

![Aujourd’hui, thème Classique](../images/web-classique.png)

![Repos › Architecture : le plan calculé depuis le code](../images/web-architecture.png)

## Raccourcis

- **⌘K** (ou **/**) : chercher une note ou aller n’importe où.
- **⌘\\** (Ctrl+\\) : replier ou déplier la barre de gauche.
- **⌘↵** : capturer depuis le champ des captures.
- **Espace**, puis **1** à **4** : révéler une carte, puis dire comment ça s’est passé.
- Dans Cerveau : **↑ ↓** pour passer d’une note à l’autre, **Échap** pour vider la
  sélection, puis fermer la note.

## Relire et approuver

![Relire une proposition](../images/web-review.png)

Ouvre une proposition dans **À valider › Propositions** : chaque fichier montre ses
lignes ajoutées et retirées, ou son aperçu, et les vérifications à droite. Décoche
les fichiers que tu ne veux pas garder, puis :

- **Approuver et appliquer** : les changements entrent dans ta KB (et un commit
  Git est créé si l’historique est actif) ;
- **Approuver sans appliquer** : pour appliquer plus tard ;
- **Écarter** : la proposition est abandonnée, ta KB ne change pas.

Pour approuver, OKB vérifie que c’est bien **toi** : sur macOS, une fenêtre de
confirmation apparaît sur ton écran ; ailleurs, la question est posée dans le
terminal où tourne `okb serve`. Un programme ou un agent qui piloterait la page ne
peut pas répondre à ta place. Si aucune des deux n’est possible, la page affiche la
commande à lancer toi-même (`okb review 1`).

Si ta KB a changé depuis la préparation de la proposition (tu as modifié une note
dans Obsidian, par exemple), la page refuse l’aperçu : la proposition doit être
préparée à nouveau. Tes modifications ne sont jamais écrasées.

## Réglages

![Réglages](../images/web-settings.png)

Dans **Réglages** (onglet Général), groupés par thème.

Chaque réglage est enregistré tout de suite et s’applique sans redémarrer.
La valeur recommandée porte une ★. Le nom technique (par exemple
`writing.language`) est le même que dans `okb settings`.

## En mode sombre

![Accueil en mode sombre](../images/web-home-dark.png)

## Sécurité, en bref

La page n’écoute que ton ordinateur, refuse les requêtes venant d’autres sites et
n’exécute jamais le contenu de tes notes. Les détails sont dans
[la documentation technique](../dev/WEB-APP.md).
