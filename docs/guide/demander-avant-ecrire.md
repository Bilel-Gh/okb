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

## Le oui proportionné

- **Ce que tu écris toi-même passe tout de suite** : une capture, une ligne du
  journal, une action, un document que tu déposes. C'est déjà ton geste.
- **Ce qu'un assistant rédige, remplace ou propose attend ton oui.**

## Oui à tout, sauf…

**À valider** s'ouvre sur tout ce qui attend : les notes que Claude propose
d'écrire, avec leur coût, et les changements prêts. Tout est coché.

1. Décoche ce que tu ne veux pas. **Lire** ouvre un changement en détail.
2. **Oui à ces N choses** : OKB te demande confirmation **une seule fois** pour
   tous les changements (une fenêtre sur ton écran, ou le terminal). Si tu
   annules, rien ne change.
3. L'écran dit ce qui est fait, et ce qui ne l'est pas : un changement qui ne
   s'applique plus tel quel, une note qui dépasserait le budget du jour.

Ce que tu as décoché reste en attente. Une note acceptée n'est pas encore
écrite : Claude l'écrit quand tu le lui demandes (« écris les suggestions
acceptées »). Un changement qu'une règle d'OKB refuse ne part pas avec le lot :
il est montré à part.

Aujourd'hui te rappelle combien de choses attendent ; `okb today` aussi.

## Chaque note a une note

| | Sur 100 | D'où elle vient |
|---|---|---|
| **Qualité** | structure, sources, clarté, liens, justesse | calculée par OKB, la justesse par le relecteur IA |
| **Valeur** | lectures, recherches, liens vers elle, 👍/👎 | ton usage |

Le global (60 % qualité, 40 % valeur) s'affiche en étoiles. `okb scores` les
liste ; la revue de la semaine montre les notes faibles à améliorer.
