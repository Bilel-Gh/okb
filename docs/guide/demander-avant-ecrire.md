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

## Ce qu'OKB repère tout seul

Pendant que tu travailles avec Claude, OKB repère six moments, sans IA et sans
rien écrire :

| Moment | Ce que ça deviendrait |
|---|---|
| une longue explication que tu as demandée (« c'est quoi X ? ») | une fiche concept |
| la même question posée deux fois | une fiche concept ou une recette |
| un bug résolu après plusieurs essais | une erreur connue |
| une erreur et sa cause | une erreur connue |
| une décision prise (« on part sur… ») | une décision |
| une commande découverte | une recette |

## Quand les cartes arrivent

- **À la fin de la session**, en une seule question : quand tu dis « merci, à
  demain » ou « fin de session », Claude te montre ce qui a été repéré. **Trois
  choses au plus** par session, les plus utiles d'abord.
- **« Pas maintenant » est retenu** : les cartes attendent dans l'application
  (**À valider**), Claude n'en reparle pas avant une semaine, et il ne propose
  plus rien dans cette session.
- Réglage `suggest.mode` : `session` (par défaut : tout à la fin), `live` (une
  carte très pertinente est aussi proposée tout de suite, toujours trois au plus
  par session), `never` (rien n'est repéré).
- Budget quotidien `budget.daily` (50 000 tokens par défaut) : au-delà, Claude
  te demande.

`okb suggest list` montre les cartes en attente ; l'application aussi
(**À valider**).

## Chaque note a une note

| | Sur 100 | D'où elle vient |
|---|---|---|
| **Qualité** | structure, sources, clarté, liens, justesse | calculée par OKB, la justesse par le relecteur IA |
| **Valeur** | lectures, recherches, liens vers elle, 👍/👎 | ton usage |

Le global (60 % qualité, 40 % valeur) s'affiche en étoiles. `okb scores` les
liste ; la revue de la semaine montre les notes faibles à améliorer.
