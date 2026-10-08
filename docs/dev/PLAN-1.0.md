# OKB 1.0 — le plan

> Version 3 du plan, validée le 6 octobre 2026. Elle guide l'implémentation de la 1.0.
> ✨ = ajouté ou revu dans cette version.

## Sommaire

0. [La promesse et les critères de réussite](#0-la-promesse-et-les-critères-de-réussite)
1. [L'organisation : le Zoom](#1-lorganisation--le-zoom)
2. [Demander avant d'écrire](#2--demander-avant-décrire)
3. [Noter les notes](#3--noter-les-notes)
4. [Le stockage robuste](#4-le-stockage-robuste)
5. [Retrouver](#5-retrouver)
6. [Les modèles de note et la qualité](#6-les-modèles-de-note-et-la-qualité)
7. [Les skills, agents et hooks](#7-les-skills-agents-et-hooks)
8. [Apprendre](#8-apprendre)
9. [La productivité au quotidien](#9-la-productivité-au-quotidien)
10. [La carrière](#10--la-carrière)
11. [Confidentialité](#11-confidentialité)
12. [Les modules](#12-les-modules)
13. [L'installation et la première heure](#13-linstallation-et-la-première-heure)
14. [Les outils retenus](#14-les-outils-retenus)
15. [Le plan par lots](#15-le-plan-par-lots)
16. [Les décisions à prendre](#16-les-décisions-à-prendre)

---

## 0. La promesse et les critères de réussite

> **Tu travailles. OKB te propose quoi retenir, le range, et te le rend au bon moment.**
> ✨ **Rien n'est écrit sans ton oui.**

| Verbe | Ce que ça veut dire |
|---|---|
| **Retenir** | Claude repère ce qui vaut la peine, te le propose avec son coût ; tu choisis |
| **Retrouver** | la bonne note en 3 secondes, toi comme Claude |
| **Apprendre** | ce que tu notes, tu le retiens, et tu vois ta progression |

### La boucle quotidienne

| Moment | Ce qu'OKB fait pour toi |
|---|---|
| **Début** de session | il lit Maintenant, te dit où tu t'étais arrêté et ce qui t'attend |
| **Pendant** le travail | il apporte les notes du fichier ouvert ou de l'erreur que tu vois ; il garde de côté ce qui mériterait une note |
| **Fin** de ticket ou de session | ✨ il te montre la liste des notes possibles, avec leur coût ; tu coches celles que tu veux |
| **Vendredi** | la revue : appris, fait, à venir, notes faibles, concepts sans fiche, cartes à réviser |
| **Fin du mois** | le bilan, le jardinage du cerveau, la vérification des sauvegardes |

### Critères de réussite, mesurés avant la 1.0

| Critère | Cible |
|---|---|
| Installation | moins de 5 minutes, aucune commande dans un terminal |
| ✨ Contrôle | 0 note écrite sans ton oui ; coût annoncé juste à ±30 % |
| Rangement | au moins 95 % des notes du jeu de test rangées sans question |
| Recherche | la bonne note dans les 3 premiers résultats pour au moins 90 % des requêtes du jeu de test |
| Vitesse | recherche en moins de 50 ms sur 5 000 notes ; app web ouverte en moins d'une seconde |
| Qualité | chaque modèle obtient au moins 80/100 de qualité, sur Sonnet et sur Opus |
| Coût | résumé de démarrage ≤ 800 tokens, quelle que soit la taille du cerveau |
| Robustesse | 0 lien cassé après 1 000 déplacements simulés ; restauration de sauvegarde vérifiée |
| Discrétion | au plus une suggestion « à chaud » tous les 10 échanges |

---

## 1. L'organisation : le Zoom

### 1.1 Le vocabulaire, le même pour tous les cerveaux

🧠 **Cerveau** › 🗄️ **Tiroir** › 📌 **Sujet** › 📝 **Note**

Un fil d'Ariane partout : `🧠 Travail › 📦 Produit A › 💻 repo2 › 🎫 ABC-123`.

| Tiroir | Question | Travail | Projets perso |
|---|---|---|---|
| 0 Entrée | pas encore rangé | capture rapide | capture rapide |
| 1 Le monde autour | c'est quoi, autour ? | Écosystème | Idées et inspirations |
| 2 Les sujets principaux | ce produit, ce projet | Produits | Projets |
| 3 Boîte à outils | comment faire ? | méthodes, recettes, concepts | pareil |
| 4 Activité | qu'est-ce que je fais, qu'ai-je fait ? | journal, carrière, réunions | journal, livraisons |

À la racine de chaque cerveau : `Accueil.md` (le cerveau en 5 min et son plan) et `Maintenant.md` (ton focus).

### 1.2 Le cerveau Travail

```text
Travail/
├─ Accueil.md                 « Mon travail en 5 min » + le plan du cerveau
├─ Maintenant.md              tableau de bord, calculé sans IA
├─ Glossaire.md               tous les concepts du cerveau, A→Z et par thème (calculé)
├─ 0 Entrée/
├─ 1 Écosystème/
│  ├─ Écosystème.md           en 5 min + la carte de tous les produits
│  ├─ Entreprise/             organisation, stratégie, processus, outils internes
│  ├─ Marché/                 clients, concurrents, partenaires, tendances
│  └─ Domaines/               Finance/ · Achats/ · Intégration/ …  (chaque domaine = un thème, avec ses concepts métier)
├─ 2 Produits/
│  ├─ Produit A/
│  │  ├─ Produit A.md         Produit A en 5 min + tout le produit
│  │  ├─ Fonctionnel/         fonctionnalités ⭐, parcours, règles métier, paramétrage, vocabulaire du produit
│  │  ├─ Architecture/        place, composants, flux, données, environnements, décisions, forces et défauts
│  │  ├─ Code/
│  │  │  ├─ repo1/
│  │  │  ├─ repo2/
│  │  │  │  ├─ repo2.md       repo2 en 5 min
│  │  │  │  ├─ repo2 — Démarrer · Tester · Déboguer · Carte du code · Livrer
│  │  │  │  ├─ Composants/
│  │  │  │  └─ Tickets/2026/ABC-123 — Export CSV.md
│  │  │  └─ repo3/
│  │  ├─ Tickets/2026/        tickets qui touchent plusieurs repos de A
│  │  └─ Support/2026/        cas clients, incidents, erreurs connues
│  ├─ Produit B/ …
│  ├─ Produit C/ …
│  └─ Socle commun/           repos et briques partagés par plusieurs produits
├─ 3 Boîte à outils/          Méthodes/ · Recettes/ · Concepts/ · Outils/ · Règles d'équipe/ · Antisèches/
└─ 4 Activité/
   ├─ Journal/2026/S41.md     une page par semaine (factuelle, calculée sans IA)
   ├─ Carrière/               réalisations, objectifs, retours, entretiens, compétences (§10)
   └─ Réunions/2026/ · Formations/ · Présentations/ · Bilans/
```

Dans le produit OKB, ces noms sont des **réglages par défaut du module dev**, modifiables. Rien de propre à une entreprise.

### 1.3 Tenir quand tout se multiplie

| Ce qui arrive avec le temps | La réponse |
|---|---|
| 300 tickets dans un dossier | un dossier par année ; la page du repo montre l'en-cours d'abord, puis un tableau |
| 30 produits | au-delà d'une douzaine, OKB propose de les grouper par ligne de produits |
| des dossiers vides partout | **structure progressive** : un dossier n'apparaît qu'avec sa première note, et se découpe au-delà d'un seuil (OKB propose, met les liens à jour, tu valides) |
| vingt fois `Démarrer` dans le graphe | **noms uniques** : sujet — type (`repo2 — Démarrer`) |
| un repo utilisé par A et B | dans `Socle commun`, relié aux deux |
| un ticket sur deux produits | dans le produit principal, relié à l'autre |
| deux repos nommés `api` | le produit s'ajoute au nom quand il le faut (`A — api`) |
| Claude face à 3 000 notes | il descend les pages « en 5 min » comme une table des matières : coût fixe |

### 1.4 L'ascenseur : comment une note trouve sa place

1. **Tiroir** : quelle question la note règle-t-elle ?
2. **Niveau** : un fait va au niveau **le plus bas** qui le contient ; une leçon monte au niveau **le plus haut** où elle reste vraie.
3. **Type** : il donne le sous-dossier, toujours le même.
4. **Nom** : la règle du type (`ABC-123 — Titre court`, `2026-10-06 Réunion …`).
5. **Étiquettes** : type, thèmes (liste fermée), produit, repo.

Claude choisit (jugement), OKB calcule le chemin (règle). En cas de doute : Entrée et une question. Ouvert dans repo2, Claude sait que c'est le produit A.

| Ce que tu découvres | Où ça va |
|---|---|
| un piège propre à repo2 | `repo2 — Déboguer` |
| une règle métier du produit A | Produit A › Fonctionnel |
| une règle commune à A et B | Écosystème › Domaines › Facturation |
| une méthode de débogage utile partout | Boîte à outils › Méthodes (« utilisée dans ABC-123 ») |

Trois principes :
- **on range par sujet, jamais par format** : ce qu'on retient d'un article ou d'une vidéo va à son sujet ;
- **une note a une seule place et plusieurs étiquettes** : elle apparaît partout où elle compte ;
- **rien ne déménage** : un ticket fini reste à sa place, marqué terminé.

### 1.5 Trois vitesses de lecture

| Vitesse | Où | Sert à |
|---|---|---|
| ⚡ 30 secondes | « En bref » en haut de chaque note | savoir si c'est la bonne note |
| ⏱️ 1 minute | ✨ les fiches concept (§1.8) | comprendre un mot |
| 🕔 5 minutes | la page de chaque sujet : entreprise, domaine, produit, repo, thème, composant important | comprendre l'essentiel |
| 🔍 en détail | les notes du sujet | travailler |

La page d'un sujet a deux parties : **en haut « X en 5 min »** (écrit par Claude après ton oui) ; **en bas l'index** (calculé, toujours à jour).

Forme fixe de chaque « en 5 min » :
1. En une phrase
2. À quoi ça sert, pour qui
3. Comment ça marche, avec un schéma
4. Sa place : au-dessus, à côté, en dessous
5. Les 5 mots à connaître (liens vers leurs fiches concept)
6. À retenir et pièges (3 points)
7. Pour aller plus loin : le parcours de lecture
8. Ce qu'on ne sait pas encore

Quand les notes en dessous changent, la page passe « à rafraîchir » et rejoint les suggestions (jamais réécrite toute seule).

### 1.6 Un graphe cohérent

- **Deux familles d'étiquettes, jamais tapées à la main** : `type/…` (posée par le modèle) et `thème/…` (choisie par Claude dans une **liste fermée**).
- **Thèmes contrôlés** : chaque thème a sa page (« Facturation en 5 min » + tout ce qui en parle) ; 3 thèmes au plus par note ; un nouveau thème passe par une suggestion ; un thème inconnu est remplacé par le plus proche ; les synonymes sont fusionnés.
- **Chaque note est reliée à sa page parente** : le graphe forme un arbre lisible.
- **Liens typés** : appelle, dépend de, remplace, concurrent de, utilisé dans, appris dans. **Les schémas d'ensemble se dessinent** à partir de ces liens.
- **Les concepts relient tout** : chaque note pointe vers les fiches des mots qu'elle utilise ; les fiches deviennent les carrefours du graphe.
- **Jardinage mensuel** proposé : doublons, notes isolées, thèmes trop gros, étiquettes inconnues.
- **Jauge de connaissance** par produit et par repo : « Produit A : 6/10, il te manque le flux de facturation ».
- **Graphe à niveaux** dans l'app web : Écosystème → produit → repo ; couleur = tiroir, taille = importance ; filtres ; chemin entre deux notes.
- **Obsidian** : couleurs par tiroir et par thème (proposées), tableaux Bases prêts.

### 1.7 ✨ Le contexte vertical : parents, enfants, voisins

Quand Claude travaille sur un sujet (une question, une suggestion, une note à écrire), OKB lui donne le contexte autour, dosé :

| Direction | Ce que Claude lit | Exemple : ticket ABC-123 dans repo2 |
|---|---|---|
| ⬆️ Parents | les pages « en 5 min » | repo2 → Produit A → Domaine Facturation → Écosystème (en bref) |
| ⬇️ Enfants | titres et « En bref » | composants de repo2 touchés, notes déjà écrites sur le ticket |
| ↔️ Voisins | titres | autres repos du produit A, tickets semblables |
| 🔗 Liés | « En bref » et fiches concept | concepts et thèmes cités |

- **Budget fixe** : environ 2 000 tokens de contexte ; Claude lit plus loin seulement si c'est utile, et le dit.
- **Visible** : chaque suggestion indique « contexte lu : 5 notes ».
- **Effet** : des notes cohérentes avec le reste, pas de doublon, le bon étage de l'ascenseur, et des réponses qui tiennent compte du produit entier.

### 1.8 ✨ Les concepts : des fiches d'une minute

**La fiche concept**, courte et toujours de la même forme :

```text
# OData
En une phrase       un protocole pour lire et modifier des données par des URL
Analogie            …
Exemple concret     …
Chez nous           où on le croise : Produit A (repo2, repo3), domaine Intégration
Pièges              …
À ne pas confondre  REST « classique »
Voir aussi          …
alias : OData, Open Data Protocol · thème : intégration · maîtrise : compris
```

**Où elles vivent** (l'ascenseur s'applique aussi) :
- concept technique → `3 Boîte à outils/Concepts/` ;
- concept métier → `1 Écosystème/Domaines/<thème>/` ;
- vocabulaire propre à un produit → `2 Produits/<produit>/Fonctionnel/`.

**Comment on y accède :**
- **depuis une note** : la première fois qu'un mot connu apparaît, il devient un lien vers sa fiche (fait par OKB, sans IA) ;
- **dans l'app** : au survol, la fiche s'affiche en bulle ; **dans Obsidian** : l'aperçu au survol fait pareil ;
- **depuis le cerveau** : `Glossaire.md` (A→Z et par thème) et la recherche ⌘K ;
- **pour Claude** : le glossaire (un mot, une ligne) coûte très peu et l'aide à parler ton vocabulaire.

**La détection des nouveaux concepts :**

| Signal | Exemple | Coût |
|---|---|---|
| Tu demandes | « c'est quoi un IDoc ? » | 0 token |
| Sigles et termes techniques sans fiche | « CDS » vu dans 5 notes | 0 (repérage par OKB) |
| Fréquence et étendue | un terme vu dans 3 sujets et 2 sessions | 0 |
| En écrivant une note | Claude liste les termes importants qu'il a utilisés et qui n'ont pas de fiche | inclus dans l'écriture |
| Dans le code | noms métier dans les classes ou les tables, sans fiche | 0 |

Chaque candidat reçoit une importance (fréquence × étendue × lien avec ton focus) et rejoint les **suggestions** (§2), regroupé : « 3 concepts importants sans fiche : ☑ OData ☑ CDS ☐ BTP ». Dans l'app, les termes sans fiche sont soulignés en pointillé : « créer la fiche ? ». Les fiches nourrissent la révision espacée et la carte de compétences.

### 1.9 Ce que chaque note sait d'elle-même

| Propriété | Exemple | À quoi ça sert |
|---|---|---|
| `id` | identifiant stable | liens qui ne cassent jamais (§4) |
| `type`, `thèmes` | `type/ticket`, `thème/facturation` | rangement, graphe, recherche |
| `produit`, `repo` | Produit A, repo2 | pages de sujet, filtres |
| `statut` | en cours, terminé, à rafraîchir | Maintenant, tri |
| `alias` | sigles, ancien nom, référence, nom anglais | recherche directe et bilingue |
| `confiance` | ✅ vérifié · 🗣️ entendu · ❓ supposé | savoir ce qui est sûr |
| `née de` | ABC-123, réunion du 6/10 | la provenance |
| `confidentialité` | normal · confidentiel · 🔒 secret | §11 |
| ✨ `score` | qualité 86 · valeur 72 · ★★★★☆ | §3 |
| `vérifié le` | 2026-10-06 | fraîcheur |

### 1.10 Maintenant et le journal : des tableaux de bord, pas des notes

**Maintenant.md** et **le journal de la semaine** sont **calculés sans IA et sans token** à partir de ton activité (branches, tickets, commits, notes créées, échéances, questions en attente). Ce sont des vues, pas des notes rédigées ; tu peux les désactiver.

| Section de Maintenant | D'où ça vient |
|---|---|
| 🎯 Objectif du moment | la seule chose que tu écris (ou dis à Claude) |
| 🔨 En cours | tickets, présentations, cas ouverts |
| ⏰ Échéances | dates trouvées dans tes notes |
| ⏸️ Où je me suis arrêté | la dernière session |
| ⏳ En attente de réponse | questions posées, depuis quand |
| 💡 Suggestions en attente | les notes proposées pas encore décidées |
| 📚 J'apprends | parcours en cours, cartes à réviser |

### 1.11 Le cerveau Projets perso

```text
Projets/
├─ Accueil.md · Maintenant.md · Glossaire.md · 0 Entrée/
├─ 1 Idées/            projets pas encore lancés, notés et comparés
├─ 2 Projets/
│  └─ Mon app/         Mon app.md (en 5 min) · Fonctionnel/ · Architecture/ · Code/<repo>/Tâches/
├─ 3 Boîte à outils/
└─ 4 Activité/         journal, livraisons
```

Même grammaire partout. Les cerveaux Travail et Projets restent séparés.

---

## 2. ✨ Demander avant d'écrire

> **Claude n'écrit jamais une note sans ton oui.** Il suggère, tu décides, il écrit dans le budget annoncé, tu relis.

### 2.1 Le parcours d'une note

| Étape | Qui | Coût |
|---|---|---|
| 1. 💡 **Suggestion** : une carte avec tout ce qu'il faut pour décider | OKB et Claude | presque rien : pas d'écriture |
| 2. ✅ **Ton choix** : créer, compléter une note existante, relier seulement, plus tard, non | toi, un clic | 0 |
| 3. ✍️ **Écriture**, dans le budget annoncé | Claude | annoncé sur la carte |
| 4. 👀 **Relecture** : la note arrive avec son score de qualité ; un clic pour l'enregistrer | toi | 0 |

### 2.2 La carte de suggestion

```text
💡 Suggestion de note                                  Pertinence 84/100
Type             🧩 Fiche concept (1 minute)
Titre            OData
Où               🧠 Travail › 🧰 Boîte à outils › Concepts
Pourquoi         tu as demandé « c'est quoi OData » ; le mot apparaît dans 4 notes sans fiche
Déjà là          aucune fiche ; proche : « Recette — appeler un service OData » (recouvrement 30 %)
Recommandation   ✅ Créer la fiche, et la relier depuis les 4 notes
Coût estimé      petit · ≈ 2 000 tokens · contexte lu : 3 notes
[Créer]  [Compléter l'existante]  [Plus tard]  [Non]
```

| Champ | Ce qu'il dit |
|---|---|
| Type | le modèle de note, et sa vitesse de lecture |
| Titre et Où | le nom et le fil d'Ariane exact (calculé par l'ascenseur) |
| Pourquoi | ce qui a déclenché la suggestion |
| Déjà là | les notes proches et leur recouvrement : **pas de doublon** |
| Recommandation | créer · compléter telle note · relier seulement · rien à faire (« la note existe, la voici ») |
| Pertinence | /100, détaillée ci-dessous |
| Coût estimé | petit, moyen ou gros, en tokens, avec ce qui sera lu |

### 2.3 La pertinence, calculée presque sans IA

| Critère | Points | Exemple |
|---|---|---|
| Nouveauté | 30 | rien de semblable dans le cerveau |
| Utilité | 30 | lié à ton focus, à un ticket en cours, à un produit que tu apprends |
| Réutilisation | 25 | le sujet revient (vu dans plusieurs notes ou sessions) |
| Ton signal | 15 | tu as posé la question, dit « je savais pas », demandé une note |

| Pertinence | Ce qu'OKB en fait |
|---|---|
| 80 et plus | proposée tout de suite, en une ligne, si le réglage le permet |
| 50 à 79 | gardée pour la fin du ticket ou de la session |
| moins de 50 | jamais proposée (visible dans la file si tu la consultes) |

### 2.4 Quand les suggestions arrivent

- **À chaud** : seulement au-dessus de 80, une ligne, au plus une tous les 10 échanges.
- **En fin de ticket et en fin de session** : la liste, avec des cases à cocher et le coût total ; tu choisis, Claude écrit seulement celles-là.
- **Quand tu veux** : « qu'est-ce qu'on garde ? », le panneau `/okb`, la page Suggestions de l'app.
- **Ou toi d'abord** : les skills (`/okb:note`, « fais la note du ticket », « fiche sur OData ») ; la carte s'affiche quand même, en version courte, pour que le coût et la place ne soient jamais une surprise.
- **Réglage** : à chaud + fin de session (par défaut) · fin de session seulement · jamais, je demande moi-même.
- La file garde les suggestions 14 jours, puis les oublie.

### 2.5 Le budget

- Un **budget d'écriture par jour** (réglable, par exemple 50 000 tokens) ; le panneau affiche « aujourd'hui : 12 000 / 50 000 ».
- Au-delà, Claude demande explicitement avant chaque note.
- Après l'écriture, le **coût réel** s'affiche à côté du coût estimé ; l'estimation s'améliore avec le temps.
- Le bon modèle pour chaque tâche : repérer et classer coûte peu (modèle rapide), écrire mérite le meilleur.

### 2.6 La garantie technique

La commande qui écrit une note **refuse sans ton accord enregistré**. C'est OKB qui enregistre ton clic (ta réponse à la question de Claude, un bouton du panneau, ou ton message), pas Claude : il ne peut pas le simuler. C'est le même principe que les approbations aujourd'hui.

### 2.7 Ce qui s'écrit sans demander (0 token, sans IA)

- les **tableaux de bord** : Maintenant, le journal factuel de la semaine, les jauges ;
- les **index** en bas des pages de sujet, le glossaire ;
- **ta capture express** : « note ça : … » range **tes propres mots** tels quels dans Entrée ; en faire une vraie note passe par une suggestion.

---

## 3. ✨ Noter les notes

Un système léger : **aucun appel d'IA en plus**, tout est calculé quand la note change ou la nuit.

| Score | Quand | Comment |
|---|---|---|
| **Qualité** /100 | à l'écriture | 5 critères : 4 vérifiés par OKB, 1 par le relecteur IA déjà dans la chaîne |
| **Valeur** /100 | au fil du temps | ce que la note t'apporte vraiment |
| **Note globale** | toujours | 60 % qualité + 40 % valeur → ★ (1 à 5) et % |

### Qualité /100

| Critère | Points | Vérifié par |
|---|---|---|
| Structure | 20 | OKB : sections du modèle, « En bref », longueur selon ton profil |
| Sources | 25 | OKB : chaque affirmation a sa source et son niveau de confiance |
| Clarté | 20 | OKB : lisibilité pour ton niveau, mots techniques expliqués ou reliés à une fiche |
| Liens | 15 | OKB : page parente, concepts, thèmes connus, schéma valide si le modèle en demande un |
| Justesse | 20 | le relecteur IA, avec la grille du modèle |

### Valeur /100

| Critère | Points | D'où ça vient |
|---|---|---|
| Utilisée | 40 | ouverte, trouvée en recherche, citée par Claude, servie dans un ticket |
| À jour | 25 | vérifiée récemment, code inchangé, pas « à rafraîchir » |
| Unique | 15 | pas de doublon |
| Ton avis | 20 | 👍 / 👎 en un clic, optionnel (neutre si tu ne dis rien) |

Une note neuve affiche sa qualité ; sa valeur se construit pendant 30 jours.

**Affichage** : `★★★★☆ 84 %` sur la note ; le détail au survol.

**À quoi ça sert :**
- **la recherche** met les meilleures notes d'abord, à égalité de pertinence ;
- **la revue du vendredi** liste les notes sous 50 : améliorer, fusionner ou archiver (en suggestion) ;
- **les tests de qualité** des modèles utilisent la même grille : ce qu'on mesure en test, on le mesure en vrai ;
- **la page Santé du cerveau** : moyenne, répartition, notes à reprendre.

---

## 4. Le stockage robuste

**Cinq promesses** : on ne perd rien · on n'efface rien · aucun lien ne casse · tes modifications ne sont jamais écrasées · tout se reconstruit depuis tes fichiers.

| Risque | Protection |
|---|---|
| Un renommage ou un déplacement casse des liens | chaque note a un **identifiant stable** ; OKB répare les liens tout seul |
| Une écriture interrompue | **écriture atomique** et **verrou** : jamais de fichier à moitié écrit, jamais deux écritures en même temps |
| Une mauvaise modification | **journal des opérations** : tout s'annule, même des semaines plus tard |
| Revenir à une ancienne version | **historique de chaque note**, local et dédupliqué, **sans Git** : voir, comparer, restaurer |
| Une suppression par erreur | **corbeille** de 30 jours ; OKB n'efface jamais définitivement |
| Le disque lâche, le Mac est perdu | **sauvegarde automatique quotidienne** vers le dossier de ton choix, rotation 7 jours / 4 semaines / 12 mois, **chiffrée en option** |
| Une sauvegarde inutilisable | **restauration testée chaque mois** dans un dossier temporaire, empreintes comparées |
| Tu modifies une note dans Obsidian pendant qu'OKB travaille | **modifications extérieures détectées** : OKB n'écrase jamais, il propose une fusion |
| Copies « 2 », conflits de synchro, pièces jointes orphelines, propriétés invalides | **contrôle d'intégrité** (`doctor`) avec réparations proposées |
| Un cerveau confidentiel dans iCloud ou OneDrive | **alerte** ; vérification que le chiffrement du disque (FileVault) est actif |
| L'index, le graphe ou les scores abîmés | ce sont des **caches**, reconstruits en une commande depuis les notes |
| Un changement de format d'OKB | **version du format** dans chaque cerveau ; migrations proposées et annulables |
| Être enfermé dans OKB | **formats ouverts** (Markdown + YAML) ; export en site, PDF, ou archive d'un sujet |

| Quoi | Où |
|---|---|
| Tes notes et pièces jointes (`_fichiers/` de chaque sujet) | le dossier du cerveau |
| L'historique, le registre local, les caches, les scores | `.okb/` dans le dossier du cerveau |
| Réglages, liste des cerveaux, file de suggestions, budget | `~/.okb/` |
| Sauvegardes | le dossier que tu choisis |

OKB ne met toujours aucun cerveau sous Git et ne pousse rien nulle part.

---

## 5. Retrouver

### Dans l'app web : une recherche ⌘K
- **tolérante** aux fautes, aux accents, aux pluriels et aux débuts de mot ;
- **trouve** par titre, alias (sigles, référence, ancien nom, nom anglais), sections, texte, **message d'erreur collé**, nom de fichier ;
- **dans cet ordre** :
  1. le meilleur résultat, ouvert avec Entrée ;
  2. les fiches concept qui correspondent ;
  3. les résultats par tiroir, avec fil d'Ariane, extrait surligné et ★ ;
  4. les notes liées ;
  5. à part, les notes proches par le sens (option) ;
- **pousse** le sujet en cours, les notes récentes et les mieux notées ;
- **filtre** par tiroir, produit, repo, type, thème, statut, période, confiance, score.

### Pour Claude
- le même moteur (`okb find`) ;
- au démarrage : la carte du cerveau, Maintenant et la page « en 5 min » du sujet où tu es ;
- le contexte vertical (§1.7) à chaque question ;
- les noms sont trouvés directement (« ABC-123 », un sigle).

### Les notes viennent à toi
- **Quand Claude lit ou modifie un fichier**, OKB lui signale les notes qui en parlent : « 📝 Composant — Calcul TVA : piège d'arrondi ».
- **Quand une commande ou un test affiche une erreur connue**, la note de l'erreur arrive avec sa solution.
- Le tout sans IA, par une correspondance fichier → notes et erreur → note.

### Les trous deviennent des suggestions
Une recherche qui ne trouve rien est gardée. Les trous qui reviennent deviennent des suggestions : « tu as cherché 3 fois *quota* sans résultat, on écrit la note ? ».

---

## 6. Les modèles de note et la qualité

### 6.1 Le registre des types
Une seule table décide, pour chaque type de note : son tiroir et son niveau, son nom, ses étiquettes, son modèle, sa couleur dans le graphe, sa vitesse de lecture et son coût habituel. C'est la garantie de cohérence. Tu peux y ajouter tes propres types en le demandant à Claude.

### 6.2 Un modèle complet
1. son but et son lecteur ;
2. ses sections, chacune avec ses règles ;
3. des longueurs selon ton profil ;
4. **un exemple parfait** ;
5. sa grille de contrôle (la même que le score de qualité, §3) ;
6. des vérifications automatiques ;
7. ses règles de rangement et son coût habituel (dans le registre).

### 6.3 Le catalogue, environ 80 modèles
★ = livré dès le lot 4, les autres ensuite.

| Niveau | Modèles |
|---|---|
| **Concepts** ✨ | ★ Fiche concept · ★ Sigle · Vocabulaire du produit · Comparaison de deux concepts |
| **Écosystème** | ★ Entreprise en 5 min · ★ Domaine en 5 min · ★ Règle métier · Processus interne · Outil interne · ★ Équipe (qui sait quoi) · Client · Concurrent · Comparatif · Partenaire · Tendance |
| **Produit** | ★ Produit en 5 min · ★ Fonctionnalité · ★ Parcours utilisateur · ★ Contexte et place · Conteneurs · ★ Flux · Modèle de données · Cycle de vie · ★ Décision · Forces et défauts · Paramétrage · Environnements et accès · Droits et rôles · Frise et versions · Roadmap · FAQ du produit · ★ Erreur connue · ★ Cas client |
| **Repo** | ★ Repo en 5 min · ★ Démarrer · ★ Tester · ★ Déboguer · ★ Carte du code · Livrer · Interfaces · ★ Composant · Fichier clé · Simplification · Dette technique · Conventions du repo · Dépendances |
| **Ticket** | ★ Ticket (bug) · ★ Ticket (évolution) · ★ Journal d'enquête · Incident et post-mortem · Leçons de revue de code · Description de PR |
| **Boîte à outils** | ★ Méthode · ★ Recette · Outil · ★ Règle d'équipe · Comparatif technique · Checklist · Antisèche |
| **Activité** | ★ Réunion (préparer + compte rendu) · ★ Formation · Lecture ou vidéo · Présentation · Bilan du mois · Passation · Première semaine |
| **Carrière** ✨ | ★ Réalisation (STAR) · ★ Retour reçu · ★ Objectif · ★ Préparer un entretien individuel · Compte rendu d'entretien · Auto-évaluation annuelle · Bilan (trimestre, année) · Plan de développement · Grille de carrière · Histoire STAR portable · CV vivant |
| **Apprendre** | Carte de révision · Parcours · Quiz du repo |

### 6.4 Ton profil de lecture
4 curseurs (niveau, visuel, longueur, exemples), des profils tout faits, réglables par cerveau. Sur n'importe quelle note : **« réexplique plus simple »** ou **« va plus loin »** donne une autre version à lire sans toucher la note (avec son coût annoncé).

### 6.5 Les schémas

| Question | Schéma Mermaid |
|---|---|
| Où se place le produit ? | contexte (C4) |
| De quoi est-il fait ? | architecture, conteneurs |
| Que se passe-t-il quand l'utilisateur fait X ? | séquence |
| Quelles données ? | entités-relations |
| Par quels états passe une commande ? | états |
| Que vit l'utilisateur ? | parcours |
| Quelles fonctionnalités ? | carte mentale |
| Face aux concurrents ? | quadrant |
| Comment a-t-il évolué ? | frise |
| Branches et livraisons ? | gitGraph |
| Qui fait quoi ? | organigramme |

Chaque schéma est vérifié par le parseur Mermaid avant d'être écrit. Une photo de tableau blanc devient un schéma.

### 6.6 La chaîne de qualité
Suggestion acceptée → contexte vertical → modèle + exemple parfait → Claude écrit → vérifications automatiques → relecteur IA avec la grille → score de qualité → toi.

**Garantie** : chaque modèle a ses tests (`claude plugin eval`), lancés avec Sonnet et avec Opus ; il n'est livré que s'il atteint 80/100 sur les deux, et les tests sont rejoués à chaque version et à chaque nouveau modèle.

---

## 7. Les skills, agents et hooks

Moins de skills, c'est un Claude qui choisit mieux et qui coûte moins cher : des skills larges, avec des descriptions courtes et mesurées. ✨ **Tous les skills qui écrivent passent par la carte de suggestion (§2).**

### 7.1 Skills du socle

| Skill | Tu dis… | Il fait |
|---|---|---|
| `okb-setup` | « configure OKB », « crée un cerveau Sport » | regarde, recommande, crée |
| `okb-capture` | « note ça », « qu'est-ce qu'on garde ? », « fiche sur OData » | suggestions, cartes, écriture après ton oui, fiches concept |
| `okb-ask` | « qu'est-ce qu'on sait sur… » | cherche avec le contexte vertical, répond avec les sources |
| `okb-today` | « où j'en suis », « mon daily », « ma semaine » | Maintenant, daily, revue du vendredi, bilan du mois |
| `okb-learn` | « interroge-moi », « explique-le-moi », « mon parcours » | révision, explication à rebours, parcours |
| `okb-meeting` | « prépare ma réunion », « voici mes notes de réunion » | ordre du jour, questions à poser, compte rendu, actions |
| `okb-present` | « prépare une présentation sur… » | message clé, plan, slides en Markdown, questions attendues |
| `okb-ingest` | « lis ce document », « voici la transcription », une photo | suggestions de notes depuis PDF, Word, transcription, image |
| `okb-garden` | « range mon cerveau », « mes notes faibles » | jardinage, intégrité, scores, fraîcheur, migrations, sauvegardes |
| `okb-career` | « note cette réussite », « prépare mon entretien » | toute la carrière (§10) |

### 7.2 Skills du module dev

| Skill | Tu dis… | Il fait |
|---|---|---|
| `okb-dev-product` | « explique-moi le produit A » | en 5 min, fonctionnel, architecture, schémas |
| `okb-dev-repo` | « je découvre repo2 », « quiz-moi sur repo2 » | découverte, parcours, quiz du repo |
| `okb-dev-ticket` | « je commence ABC-123 », « j'ai fini » | brief, journal, suggestions de fin de ticket (note, ascenseur, concepts, réalisation) |
| `okb-dev-explain` | « explique ce fichier », « dessine le flux » | composant, fichier clé, schémas vérifiés |
| `okb-dev-debug` | « j'ai cette erreur » | erreur connue ou journal d'enquête |
| `okb-dev-review` | « relis mon diff », « j'ai reçu ces commentaires » | pré-revue avec les règles d'équipe, leçons de revue |
| `okb-dev-ship` | « écris ma PR », « mon message de commit » | depuis la note du ticket |
| `okb-dev-support` | « un client a ce problème » | cas client, diagnostic, réponse type |

### 7.3 Agents (invisibles, appelés par les skills)

| Agent | Rôle | Modèle |
|---|---|---|
| `okb-filer` | classer, étiqueter, estimer la pertinence et le coût | rapide et peu cher |
| `okb-concept-spotter` ✨ | repérer les concepts importants sans fiche dans un texte | rapide et peu cher |
| `okb-quality-reviewer` | appliquer la grille du modèle | Sonnet |
| `okb-evidence-reviewer` | vérifier les sources | existant |
| `okb-repo-explorer` | lire une partie d'un repo | existant |
| `okb-extractor` | extraire d'une longue source | existant |
| `okb-diagrammer` | construire et vérifier un schéma depuis le code | Sonnet |

### 7.4 Hooks (automatismes sans IA)

| Moment | Ce qui se passe |
|---|---|
| Début de session | carte du cerveau + Maintenant + page « en 5 min » du sujet + glossaire court |
| Message envoyé | comprend l'intention, change de cerveau ou de sujet, enregistre ton accord |
| Fichier lu ou modifié | notes de ce fichier |
| Commande lancée | commits → ticket ; erreur connue → sa note |
| Fin de réponse | ✨ repère les moments et les concepts → **file de suggestions** (rien n'est écrit) |
| Fin de session | ✨ te montre les suggestions de la session ; calcule le journal factuel et la suite |
| Garde-fous | ✨ aucune écriture de note sans ton accord enregistré ; personne d'autre que toi n'approuve ; notes 🔒 non lues sans ta demande |

---

## 8. Apprendre

| Fonction | Ce que ça fait |
|---|---|
| **Fiches concept** ✨ | un mot, une minute ; reliées depuis toutes les notes |
| **Parcours** | par produit, domaine, repo : un ordre de lecture et ta progression |
| **Niveaux de maîtrise** | découvert → compris → appliqué → maîtrisé ; avance tout seul (lu, quiz réussi, utilisé dans un ticket, expliqué) |
| **Carte de compétences** | ce que tu maîtrises, tiré de tes niveaux (§10) |
| **Révision espacée** | des cartes tirées de tes fiches et notes (sigle, concept, règle, commande), planifiées par FSRS ; 5 minutes par jour, dans l'app ou avec Claude ; tu choisis ce qui mérite d'être retenu |
| **Explique-le-moi** | tu expliques, Claude compare avec la note et montre ce qui manque |
| **Quiz du repo** | « où modifie-t-on la TVA ? » : apprendre le code par questions |
| **Objectifs** | « maîtriser le produit A d'ici décembre » : plan, jalons, progression dans Maintenant |
| **Apprendre de ses tickets** | « ce que j'ai appris » devient des cartes |
| **Glossaire** | tous les concepts, au survol dans l'app et dans Obsidian |

---

## 9. La productivité au quotidien

| Fonction | Ce que ça t'évite |
|---|---|
| **Daily en 10 secondes** | chercher ce que tu as fait hier |
| **Rapport de la semaine** (brouillon) | réécrire ta semaine pour ton manager |
| **Brief de ticket** | tickets semblables, notes utiles, fichiers probables, questions, plan |
| **Les notes viennent à toi** | chercher la note du fichier que tu modifies |
| **Erreurs connues automatiques** | redéboguer une erreur déjà résolue |
| **Pré-revue** | ton diff relu avec les règles que ton équipe t'a déjà données en revue |
| **PR et commits** | rédigés depuis la note du ticket |
| **Réunions** | préparées (contexte, questions à poser), puis compte rendu et actions dans Maintenant |
| **Question à une autre équipe** | un brouillon clair avec le contexte, jamais envoyé sans toi |
| **Recettes exécutables** | « lance les tests de repo2 » : la commande de la note |
| **Transcriptions et photos** | une réunion ou un tableau blanc deviennent des suggestions de notes |
| **Questions en attente** | une relance proposée au bout de 3 jours |
| **Reprendre où j'en étais** | la fin de session calcule la suite |
| **Capture express** | « note ça : … » garde tes mots dans Entrée, sans token |

---

## 10. ✨ La carrière

> **Ton dossier est toujours prêt** : tu n'oublies plus rien de ce que tu as fait, tu sais où tu en es, tu arrives préparé à chaque entretien, et ta carrière part avec toi.

### 10.1 Où ça vit

**Dans le cerveau Travail** (confidentiel, reste au travail) :

```text
4 Activité/Carrière/
├─ Carrière.md            ma carrière en 5 min : où j'en suis, objectifs, dernières réussites
├─ Réalisations/2026.md   une entrée par réussite (format STAR)
├─ Objectifs/2026.md      les objectifs de l'année et leurs preuves
├─ Retours/               les retours reçus : revues de code, manager, collègues
├─ Entretiens/            préparations et comptes rendus (individuels, annuel)
├─ Grille.md              la grille de carrière de ton entreprise (si tu la colles)
└─ Compétences.md         ta carte de compétences (calculée)
```

**Dans un cerveau perso « Carrière »** (portable, à toi pour toujours) :

```text
Carrière/
├─ Parcours.md            ton CV vivant : postes, missions, compétences
├─ Histoires/             tes réussites racontées en STAR, sans aucun détail interne
├─ Compétences/           ce que tu sais faire, avec des preuves génériques
├─ Apprentissages/        méthodes et concepts génériques
└─ Projets perso          les liens vers ce que tu as construit à côté
```

### 10.2 Les fonctions

| Fonction | Comment ça marche |
|---|---|
| **Une réussite en 30 secondes** | à la fin d'un ticket, d'un cas, d'une présentation ou d'une formation, une suggestion : « je note cette réussite ? ». Format **STAR** (Situation, Tâche, Action, Résultat), avec les compétences mobilisées et les preuves (ticket, PR, note). Claude te pose **une seule question** : « qu'est-ce que ça a apporté ? » (temps gagné, bug évité, client satisfait…) |
| **Les retours reçus** | « note ce retour » : rangé (point fort ou à travailler), relié aux compétences. OKB repère les répétitions : « 3 retours sur le découpage des PR » → un plan d'action et une règle d'équipe |
| **Les objectifs** | tu colles tes objectifs de l'année ; chaque réussite est proposée comme preuve de l'objectif qu'elle sert ; une barre de progression ; une alerte douce si un objectif n'a aucune preuve depuis 2 mois |
| **La grille de carrière** | tu colles une fois la grille de compétences ou de niveaux de ton entreprise ; OKB place tes preuves dessus : « pour le niveau suivant, il te manque : présenter devant un client, être autonome sur un produit » |
| **La carte de compétences** | technique (langages, produits, outils), métier (domaines), transverses (communiquer, présenter, collaborer, autonomie) ; le niveau vient de la maîtrise, des réussites et des retours ; un radar dans l'app |
| **Préparer un entretien individuel** | réussites depuis la dernière fois, blocages, questions, demandes, et le suivi des actions du précédent |
| **Préparer l'entretien annuel** | une auto-évaluation par objectif, avec ses preuves ; les temps forts ; tes souhaits d'évolution ; puis le compte rendu et les nouveaux objectifs |
| **Les bilans** | mois, trimestre, année : les chiffres sont calculés sans IA (tickets, produits appris, présentations, formations, concepts maîtrisés) ; un résumé rédigé en suggestion |
| **Le plan de développement** | les écarts (grille, objectifs, carte) deviennent des objectifs d'apprentissage, reliés aux parcours et à la révision |
| **Montrer ta valeur** | un brouillon « mes réussites de la semaine » pour ton manager ; c'est toi qui l'envoies |
| **Des rappels discrets** | « aucune réussite notée depuis 3 semaines : rien oublié ? » ; « entretien annuel dans 30 jours : on prépare ? » (dans la revue du vendredi) |
| **Ta carrière part avec toi** | Claude réécrit une réussite **sans aucun détail interne** (noms de clients, codes internes, chiffres confidentiels) ; un détecteur bloque ce qui reste ; tu relis ; elle rejoint le cerveau Carrière. Ce cerveau donne ensuite ton CV vivant, des paragraphes de CV ou de profil, et une **banque d'histoires STAR** pour tes futurs entretiens d'embauche |
| **Les projets perso comptent** | ce que tu livres dans le cerveau Projets peut devenir une réussite de ta carrière |

### 10.3 Les modèles et le skill
- **Modèles** : Réalisation (STAR), Retour reçu, Objectif, Préparer un entretien individuel, Compte rendu d'entretien, Auto-évaluation annuelle, Bilan, Plan de développement, Grille de carrière, Histoire STAR portable, CV vivant.
- **Skill `okb-career`** : « note cette réussite » · « note ce retour » · « où j'en suis sur mes objectifs » · « prépare mon 1:1 » · « prépare mon entretien annuel » · « que me manque-t-il pour le niveau suivant ? » · « rends ça portable » · « mets à jour mon CV ».
- **App web** : une page Carrière avec la frise des réussites, le radar des compétences, les objectifs et leurs preuves, les retours.

---

## 11. Confidentialité

| Fonction | Ce que ça fait |
|---|---|
| **Niveaux par note** | normal · confidentiel · 🔒 secret. Une note 🔒 n'est lue par Claude que sur ta demande, n'est jamais exportée, ni copiée vers un autre cerveau |
| **Données personnelles et clients** | détection (e-mails, téléphones, noms de clients dans le Support) : avertissement, anonymisation proposée |
| **Secrets techniques** | toujours refusés (déjà le cas) |
| **Cerveau Travail** | local, hors des dossiers synchronisés, sauvegardes locales |
| **Copie vers le cerveau Carrière** | seulement après nettoyage, détection et ta relecture (§10) |
| **Politique de ton entreprise** | un réglage « ce que l'IA peut lire » par cerveau |

---

## 12. Les modules

| Module | Contenu |
|---|---|
| 🧠 **okb**, le socle | cerveaux, tiroirs, rangement, suggestions, scores, stockage, recherche, concepts, apprendre, Maintenant, réunions, présentations, carrière, app web, graphe |
| 💻 **okb-dev** | Écosystème, Produits, Repos, Tickets, Support ; les 8 skills dev ; schémas depuis le code ; pré-revue ; erreurs connues |
| 🎓 apprendre · 📊 manager · 🤝 commercial · 🏃 vie | préparés après la 1.0 |

Chaque module est un plugin Claude Code qui dépend du socle. Pas de connecteur vers des outils professionnels (tickets, service desk) : tu colles le texte.

---

## 13. L'installation et la première heure

1. Dans Claude Code : `/plugin marketplace add <propriétaire>/okb`, puis `/plugin install okb-dev@okb`.
2. « Configure OKB » : Claude regarde tes dossiers, pose 3 questions (à quoi va servir OKB, le nom du cerveau, ton profil de lecture), montre l'aperçu, crée tout.

La commande `okb` est livrée dans le plugin : une seule version, mise à jour par Claude Code. Seul prérequis : Node 22.

### La première heure
- OKB repère tes repos et propose de les regrouper par produit ;
- il **suggère** « repo en 5 min » pour le repo où tu es, et un squelette d'Écosystème tiré des README, avec leur coût ;
- il reprend ton ancienne KB avec le même rangement (le reste va dans Entrée).

### Autres garanties
- **Un guide en 10 minutes**, et des astuces dans l'app au bon moment.
- **Tout s'annule** : c'est ce qui permet de laisser Claude agir.

---

## 14. Les outils retenus

| Outil | Rôle |
|---|---|
| Plugins Claude Code (`bin/`, dépendances entre plugins, mises à jour) | installation en une phrase, modules |
| `claude plugin eval` | qualité vérifiée sur Sonnet et Opus |
| Hooks Claude Code (message, fichier lu, commande, fin de réponse, fin de session) | suggestions, notes qui viennent à toi, garde-fous |
| Parseur Mermaid (déjà dans OKB) | aucun schéma cassé |
| Orama | recherche instantanée tolérante, sans dépendance |
| ts-fsrs | révision espacée (algorithme FSRS) |
| Obsidian Bases | tableaux dans Obsidian, sans plugin |
| Petit modèle local multilingue (118 Mo), en option | recherche par le sens |

Écartés : connecteurs vers des outils professionnels, Dataview.

---

## 15. Le plan par lots

| Lot | Contenu | Ce que tu verras |
|---|---|---|
| **0. Socle robuste et organisation** | registre des types, tiroirs, zoom, ascenseur, noms, identifiants stables, pages de sujet, structure progressive, étiquettes, contexte vertical, place des concepts, tableaux de bord ; écriture atomique, historique, corbeille, sauvegardes, intégrité ; passage de tes KB | un **cerveau de démo fictif à grande échelle** (3 produits, 8 repos, 200 tickets, 100 réunions) ; les KB existantes rangées (une proposition, annulable) |
| **1. Modules et installation** | plugin autonome, socle / okb-dev, setup en 3 questions, première heure, reprise d'une ancienne KB | installer sur un Mac vierge en une phrase |
| **2. Suggestions et scores** ✨ | carte de suggestion, pertinence, budget, garantie d'accord, file de suggestions, scores de qualité et de valeur, détection des concepts | plus aucune note sans ton oui ; chaque note avec ses ★ |
| **3. Retrouver** | ⌘K, alias bilingues, erreurs, graphe à niveaux, glossaire au survol, Obsidian, notes qui viennent à toi | taper 3 lettres et tomber sur la bonne note |
| **4. Modèles et qualité** | les ★ du catalogue, profil, vitesses de lecture, schémas vérifiés, tests Sonnet et Opus | la même qualité sur les deux modèles |
| **5. Module dev** | les 8 skills dev, pré-revue, PR, support | « ticket sur repo2 » de bout en bout |
| **6. Apprendre et carrière** ✨ | fiches concept, parcours, maîtrise, révision espacée, quiz du repo ; réussites, retours, objectifs, grille, entretiens, cerveau Carrière portable | ta progression et ton dossier toujours prêt |
| **7. Productivité et fluidité** | daily, réunions, fin de session, confidentialité, rapports | Claude te fait gagner du temps chaque jour |
| **8. Bêta réelle** | deux semaines d'usage au travail, mesures des critères (§0), corrections | la 1.0 |
| **9. Modules suivants** | apprendre, manager, commercial, vie | après la 1.0 |

Chaque lot : une démo sur des données fictives, puis ton go pour le suivant.

---

## 16. Les décisions à prendre

1. **Le réglage par défaut des suggestions** : à chaud au-dessus de 80 + liste en fin de session (recommandé), ou fin de session seulement ?
2. **Le budget d'écriture par jour** : 50 000 tokens par défaut, ou une autre valeur, ou pas de limite (juste l'affichage) ?
3. **La note globale** : 60 % qualité + 40 % valeur, affichée en ★ et en % : ça te va ?
4. **Les tableaux de bord sans IA** (Maintenant, journal factuel, index) : dans le cerveau comme fichiers, ou seulement dans l'app ?
5. **La recherche par le sens** : option dès le lot 3, ou plus tard ?
6. **Les sauvegardes** : vers quel dossier (disque externe, autre dossier local) ?
7. **Ton go pour le lot 0.**
