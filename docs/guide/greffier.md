# Le greffier : tes conversations deviennent des notes

Pendant que tu travailles, OKB se tait (D76). Le greffier passe derrière : il
lit tes conversations Claude Code et tient à jour, sans te déranger :

- le **journal du ticket** : ce qui a été fait, décidé, essayé ;
- la **fiche du ticket** : où il en est et la prochaine étape ;
- les **notes** utiles, trois au plus par conversation, qui citent mot pour mot
  ce qui a été dit.

## L’allumer, l’éteindre

C’est ton réglage : Claude ne peut pas le changer à ta place.

```bash
okb scribe on          # après coup : quand la conversation se termine
okb scribe on --live   # en direct en plus : par lots, toutes les 20 demandes
okb scribe off         # plus rien n'est lu
okb scribe             # où il en est : mode, budget du jour, dernières conversations
```

**Après coup** convient à presque tout le monde. **En direct** sert quand tu
gardes une conversation ouverte toute la journée : le journal et la fiche
suivent au fil de l’eau, et les notes attendent la fin pour ne pas garder une
piste abandonnée.

## Choisir ce qu’il lit

```bash
okb scribe exclude ~/code/perso   # jamais ce dossier
okb scribe include ~/code/perso   # de nouveau
```

Dans une conversation, tape `/okb:off` pour qu’elle ne soit jamais lue, et
`/okb:on` pour revenir en arrière. Hors de Claude :
`okb scribe skip --session <id>`.

## Le soir et au réveil

Une conversation coupée net (ordinateur fermé, terminal tué) n’a pas de fin
propre. Le greffier la rattrape le soir à 19 h et à l’ouverture de ta session :

```bash
okb scribe schedule            # affiche ce qui sera installé
okb scribe schedule --install  # macOS : un LaunchAgent ; ailleurs, les lignes cron à ajouter
```

Le matin, il ne prend que la moitié du budget du jour, pour en laisser à ta
journée. À la main : `okb scribe run --all`.

## Ce qu’il dépense

Une conversation vide, courte ou sans travail est écartée sans appel à l’IA.
Rien n’est lu deux fois. Le budget est à part du reste d’OKB :
400 000 tokens par jour par défaut.

```bash
okb settings set scribe.budget=600000
```

## Et ton oui ?

Une note du greffier suit les règles de ta KB, comme toute note d’agent : avec
« l’agent range, je relis plus tard » (D71), elle est classée à relire ;
sinon, elle attend ton oui. Une note que tu as validée ne change jamais sans
toi. Une note qui existe déjà est complétée au lieu d’être recréée.

Les paragraphes qui contiennent un secret (clé, jeton, mot de passe) ne sont
jamais envoyés au modèle.
