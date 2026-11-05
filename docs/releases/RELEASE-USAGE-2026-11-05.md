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
