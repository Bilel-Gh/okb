# Version 1.5.0

> **L'application web devient la porte d'entrée d'OKB.** Claude Code reste là,
> en option, pour lire tes sources et écrire avec toi.
> ✨ **Rien n'est écrit sans ton oui** — toujours.

## Une nouvelle application, une identité

- Une interface refaite (React, servie par `okb serve` comme avant, rien chargé
  d'Internet), dessinée à partir de maquettes validées.
- **Deux thèmes** : Atelier (violet, barre sombre, barre d'état) et Classique
  (vert, clair) ; clair, sombre ou auto ; **dégradé** ou **à plat** pour tout le
  site ; une seule police, Inter ; le logo au choix parmi les propositions.
- Toutes les pages de la 1.0 rangées en **13 destinations** : Aujourd'hui, Cerveau,
  Graphe, Demander, À valider, Repos, Apprendre ; Outils, Entretien, Modules,
  Claude Code, Réglages, Aide. Chaque onglet a son adresse ; les anciennes adresses
  mènent au bon endroit.
- Chaque type de note a son icône, dans un carré de sa couleur.

## Cerveau : tout ranger, tout retrouver

- L'arbre de tes dossiers, **dépliable à tous les niveaux**, ou tes notes **par
  type** ; la liste groupée par type ou par dossier, chaque groupe repliable ; la
  page d'un dossier quand aucune note n'est ouverte.
- **Filtres** cumulables (types, statut, qualité, date, 🔒), **tri**, vues **liste,
  tableau ou cartes**, **vues enregistrées** (et trois prêtes), notes **épinglées**
  et récentes.
- **Sélection multiple** : changer le type ou rendre 🔒 plusieurs notes en une
  seule proposition, copier leurs liens.
- Une note se lit mieux : encadrés colorés, code sur fond sombre, tableaux, plan qui
  suit la lecture, notes liées et petit graphe autour de la note.
- **Les concepts au survol** : le mot souligné en pointillé montre, dans une bulle,
  la phrase « En une phrase » de sa fiche — à la souris, au clavier ou d'un toucher.
- **Traduire** une note à la demande : « En bref » d'abord, le coût annoncé, un
  cache par section (relire ne coûte rien), la langue de la note respectée,
  « en faire une note » par une proposition.

## Graphe

- Les notes regroupées par thème détecté, par type ou par dossier, chaque thème
  dans un disque teinté au bord net, les notes très reliées cerclées de leur couleur.
- Le cerveau **vu d'en haut**, tiroir par tiroir, en bulles.

## Demander à ton cerveau

- Une recherche **par le sens** (sans modèle à télécharger) : 95 % de bonnes notes
  dans les trois premières sur des questions reformulées.
- **Demander** : les passages qui répondent, puis, sur ton clic, une réponse qui
  cite chacun d'eux.

## Repos

- Le **niveau de connaissance** de chaque repo sur 100, sans IA, qui vieillit quand
  le code change, et les trois pas qui rapportent le plus.
- L'**architecture calculée depuis le code** : qui appelle qui, chaque ligne avec sa
  preuve (fichier et ligne), auto-évaluée ; un plan à zoomer.
- L'**examen de connaissance** : Claude répond aux questions d'onboarding et à
  celles de ton équipe **avec les notes seulement**, et chaque réponse est vérifiée
  contre le code, la réponse d'une personne ou la réponse attendue
  (`okb repo exam`, et sur la fiche du repo).
- Les repos d'un cerveau reçu ou de la démo apparaissent, avec un bouton pour les
  relier à leur code.

## Partager et progresser

- **Packs** : les notes d'un sujet dans un fichier pour un collègue, comparées avec
  son cerveau, fusionnées par une proposition (`okb pack`, et **Outils › Partager**).
- **Progression** personnelle : expérience et badges, sur ton ordinateur seulement.

## Fondations

- **Modules** par métier (cœur, développeur ; devops et commercial à venir), prêts
  pour des licences ; page Modules et page « Utiliser OKB dans Claude Code » avec
  installation en un clic.
- Un **identifiant de personne** stable et un rôle dans les reçus et les décisions.
- L'IA d'OKB : Claude Code s'il est là, sinon ta clé d'API — qui prend le relais si
  Claude Code est déconnecté ; budget du jour pour tout, appels un par un.
- Les titres des propositions dans ta langue.
