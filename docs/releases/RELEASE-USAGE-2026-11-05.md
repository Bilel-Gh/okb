# Le greffier : 5 novembre 2026

Checkout de développement non publié ; le numéro du paquet reste 2.4.0.

> **« Il prend des notes de ma conversation, et je n’ai rien à faire. »**

- **Le greffier** (D77) lit tes conversations Claude Code et tient à jour le
  journal du ticket, sa fiche (où tu en es, la prochaine étape) et les notes
  utiles. Pendant le travail, il ne dit rien.
- **Deux façons de le faire travailler** :
  - `okb scribe on` : **après coup**, quand la conversation se termine, et le
    soir à 19 h pour celles qui lui ont échappé ;
  - `okb scribe on --live` : **en direct** en plus, par lots toutes les 20
    demandes. Le journal et la fiche suivent au fil de l’eau ; les notes
    attendent la fin.
- **Un interrupteur à chaque niveau** : `okb scribe off` partout,
  `okb scribe exclude <dossier>` pour un dossier, `/okb:off` pour la
  conversation en cours (`/okb:on` pour revenir).
- **Pas de doublon, pas de tokens perdus** : une conversation sans travail est
  écartée sans appel à l’IA, rien n’est lu deux fois, chaque ligne cite mot pour
  mot la conversation, et une note qui existe déjà est complétée au lieu d’être
  recréée. Budget à part : 400 000 tokens par jour, réglable
  (`okb settings set scribe.budget=…`).
- **Le soir et au réveil** : `okb scribe schedule --install` (macOS).
- **Où il en est** : `okb scribe`.

Rien ne change pour ton oui : une note du greffier suit les règles de ta KB
(D71) et une note validée ne change jamais sans toi.

## La porte de qualité (D78)

Une note que Claude ou le greffier range seul passe d’abord une porte, sans
IA : elle cite sa source, ne redit pas une note existante, est rangée au bon
endroit, n’a ni tiret cadratin ni phrase interminable, et un concept a sa
phrase de résumé. Une note arrêtée n’est jamais affichée comme faite : elle
est réécrite une fois, sinon elle t’attend avec la raison écrite dessus.

## L’écran de retour

- **Accueil** : tes tickets en trois onglets, **Tous**, **Jira** (bleu) et
  **ServiceNow** (vert), les cinq derniers de chacun avec leur statut, leur
  mission en une ligne et le repo.
- **Page Tickets** : les mêmes onglets, vingt tickets par page.
- **Fiche d’un ticket** : un onglet **Comment je l’ai résolu**. Une timeline
  quand il y a eu un bloqueur, une review qui demande des changements ou une
  réouverture (explication, bloqueur, correction, review), une explication
  courte avec le lien de la PR quand il est passé du premier coup.
- Un numéro ServiceNow (`INC0012345`, `RITM…`, `CHG…`) est reconnu comme une
  référence de ticket, par l’app comme par le greffier.

## Les méta-repos (D79)

- `okb meta` dans ton dossier de méta-repos : pour chacun, les repos de
  l’équipe, les dépendances (en lecture seule), les owners, les pipelines, les
  docs, les notes de passation, le glossaire et les skills de livraison.
- Claude le sait aussi : dans un méta-repo, son brief dit où il se trouve,
  qu’une dépendance ne se modifie pas, et quels skills de livraison utiliser
  sans les réécrire.
- OKB ne touche à rien dans tes méta-repos : il lit, c’est tout.

## Moins de choses à l’écran (D80)

La carrière, l’XP et les badges, la traduction, l’examen d’un repo, le partage
à deux, l’écran Assistant et l’app desktop sont gelés : cachés, mais rien
n’est supprimé. Les cartes de révision restent. Pour tout revoir :
`okb settings set frozen=`.

## Les formations (D81)

Demande à Claude « prépare-moi une formation sur … pour le … » : elle arrive
comme une note à relire, et ses liens dans l’ordre sont les étapes. Dans
**Progresser › Formations**, tu vois pour chacune son objectif (révision,
certification, compétence), le compte à rebours, l’avancement, l’étape
suivante et les cartes de révision à revoir.
