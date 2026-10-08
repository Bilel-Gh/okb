# Version 1.0.0

> **Tu travailles. OKB te propose quoi retenir, le range, et te le rend au bon moment.**
> ✨ **Rien n'est écrit sans ton oui.**

## Organiser : le cerveau et le Zoom

- Des **cerveaux** en cinq tiroirs (`0 Entrée`, `1 Écosystème`, `2 Produits`,
  `3 Boîte à outils`, `4 Activité`), quatre préréglages : travail, projets perso,
  sujets, carrière.
- Le **Zoom** produit → repo → ticket, une page « en 5 min » par sujet, un fil
  d'Ariane sur chaque note, l'**ascenseur** (un fait en bas, une leçon en haut).
- Un moteur d'adresse pour ~90 types de note ; des identifiants stables.
- `okb brain migrate` passe une KB classique en cerveau par une proposition ;
  `okb brain demo` crée un cerveau fictif pour essayer.
- « Maintenant » (`okb now`) : objectif, tickets, échéances, questions en attente.

## ✨ Demander avant d'écrire

- Les **cartes de suggestion** : type, place, raison, notes existantes,
  recommandation, pertinence /100, coût. Ton oui est enregistré par OKB.
- Dans un cerveau, aucune note préparée par Claude sans carte acceptée.
- Un budget quotidien ; les cartes à chaud seulement quand elles valent le coup.
- Chaque note a sa **qualité** et sa **valeur** sur 100, en étoiles.

## Retrouver

- `okb find` et ⌘K : fautes de frappe, accents, pluriels, deux langues,
  messages d'erreur, références de ticket ; les notes d'un fichier ouvert.
- Le **graphe par niveaux** : tiroirs → produit → repo.
- p95 de 6 ms sur 4 600 notes.

## Écrire juste

- ~60 **modèles** de note, chacun avec son « En bref », sa grille et souvent un
  exemple parfait (`okb template show <id> --example`).
- Les diagrammes Mermaid vérifiés avant la relecture.
- Le relecteur **`okb-quality-reviewer`** note chaque brouillon.
- Le **profil de lecture** en une commande (`okb settings profile beginner-visual`).
- Des évaluations Sonnet et Opus (`claude plugin eval ./plugin --tag quality`).

## Le module développeur `okb-dev`

Huit compétences : produit, repo, ticket, expliquer, déboguer, pré-revue
(règles d'équipe), commit et PR, support. `okb dev review`, `okb dev ship`,
`okb product show`.

## Apprendre et la carrière

- Révision espacée (FSRS) des fiches concepts et des lignes « Q : … — R : … »,
  carte des compétences, quiz sur un repo ou un produit, objectifs (`okb learn`).
- Carrière : histoires STAR avec preuves, retours, objectifs, préparation des
  entretiens, copie portable vérifiée (`okb career`).
- Les pages **Réviser** et **Carrière** de l'application web.

## Au quotidien

- `okb journal` : ce qui s'est passé jour par jour, pour le daily et le rapport
  de la semaine.
- Les compétences `okb-today`, `okb-capture`, `okb-garden`, `okb-meeting`.
- Le panneau OKB dans Claude Code montre les suggestions et les cartes à réviser.

## Robustesse et confidentialité

- Historique sans Git, corbeille de 30 jours, sauvegardes quotidiennes vérifiées,
  `okb brain check` et `okb brain repair`.
- Notes 🔒 : invisibles pour Claude sauf si tu les nommes ; données personnelles
  signalées à la relecture.
- Correction : les actions du cerveau dans l'application web (accepter une
  carte, noter, restaurer, sauvegarder) vérifient maintenant le jeton de session.

## Installer

Par Claude seulement : la marketplace, le plugin `okb` (et `okb-dev`), puis
« configure OKB pour moi ». Voir [Installer OKB](../guide/installer.md).

## Mesurer

`okb metrics` mesure en local les critères de la 1.0 : contrôle, rangement,
recherche, vitesse, qualité, coût du démarrage, robustesse, discrétion, usage.

Décisions : D36 à D46. Vérification : `npm run release:check`.
