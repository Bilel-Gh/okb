# Rien n'est écrit sans ton oui

Écrire une note coûte des tokens, et une note inutile encombre. Alors Claude
**propose d'abord** et tu choisis.

## La carte de suggestion

Quand un moment mérite une note (tu as demandé « c'est quoi X ? », un bug est
résolu, une décision est prise), Claude te montre une carte :

| | |
|---|---|
| **Type** | concept, erreur connue, recette, décision… |
| **Place** | le chemin exact et le fil d'Ariane |
| **Pourquoi** | la raison, en une phrase |
| **Déjà là** | les notes qui couvrent déjà le sujet |
| **Recommandation** | créer · compléter une note · seulement un lien · rien |
| **Pertinence** | sur 100 |
| **Coût** | les tokens estimés |

Tu réponds **Créer**, **Compléter**, **Plus tard** ou **Non**. Ton oui est
enregistré par OKB à partir de ton clic ou de ton message : Claude ne peut pas
le faire à ta place. Dans un cerveau, OKB refuse une note que Claude prépare
sans carte acceptée.

## Quand les cartes arrivent

- **Tout de suite** seulement si la pertinence dépasse 80, au plus une fois tous
  les dix échanges.
- Les autres attendent la **fin du ticket ou de la session** : une seule liste à
  cocher, avec le coût total.
- Réglage `suggest.mode` : `live` (par défaut), `session` (seulement en fin),
  `never`.
- Budget quotidien `budget.daily` (50 000 tokens par défaut) : au-delà, Claude
  te demande.

`okb suggest list` montre les cartes en attente ; l'application web aussi
(**Suggestions**).

## Chaque note a une note

| | Sur 100 | D'où elle vient |
|---|---|---|
| **Qualité** | structure, sources, clarté, liens, justesse | calculée par OKB, la justesse par le relecteur IA |
| **Valeur** | lectures, recherches, liens vers elle, 👍/👎 | ton usage |

Le global (60 % qualité, 40 % valeur) s'affiche en étoiles. `okb scores` les
liste ; la revue de la semaine montre les notes faibles à améliorer.
