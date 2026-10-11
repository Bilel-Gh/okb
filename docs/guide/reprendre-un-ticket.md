# Reprendre un ticket

Dans le module Développeur, ouvre un ticket pour retrouver son objectif, ta dernière action, les pistes qui ont échoué et la prochaine étape. Corrige ces lignes quand elles ne reflètent plus ton travail.

Le travail, la PR et sa revue, les vérifications, l’attente et la livraison ont chacun leur état. **Inconnu** veut dire que tu n’as pas encore cette information. Une PR fusionnée ne confirme pas une livraison en production ; chaque environnement se suit séparément.

Avant de terminer, relis les tests, la documentation, la recette et la confirmation. Rends obligatoires les critères dont ton ticket a besoin. Ils doivent être satisfaits ou explicitement écartés avant de clôturer le travail. Ces cases ne lancent aucun test à ta place.

Une piste échouée se note avec ses conditions : ce qui a été essayé, dans quel contexte et ce qui s’est passé. **Réutiliser une note** garde la révision qui t’a aidé sur ce ticket. Dans **Aujourd’hui**, les notes qui citent du code modifié apparaissent à revérifier ; ouvre leur source avant de proposer une correction.

Le terminal propose le même suivi, sans IA :

```sh
okb ticket brief ABC-123 --goal "Exporter sans doublons" --last-action "Testé la pagination" --next "Vérifier la CI"
okb ticket state checks passed --ticket ABC-123
okb ticket state delivery deployed --environment staging --ticket ABC-123
okb ticket criterion add "100 lignes exportées sans doublon" --kind tests --required --ticket ABC-123
okb ticket criterion set <identifiant-affiché> --status met --ticket ABC-123
okb ticket attempt "OFFSET" --conditions "Insertion entre deux pages" --result "Doublons" --next "Essayer keyset" --ticket ABC-123
okb ticket reuse "guides/pagination.md" --why "Le tri stable a aidé" --ticket ABC-123
okb ticket close ABC-123
```

Ajoute `--kb <profil>` si tu veux nommer explicitement le cerveau concerné. `okb ticket done` garde son parcours existant pour préparer les faits d’une note de ticket à proposer ensuite ; `close` termine seulement le travail local.

La lecture GitHub est facultative. Elle utilise ta session `gh` existante, après autorisation du serveur et de la liste des dépôts. Chaque lecture se déclenche par ton clic ou ta commande ; OKB ne se connecte pas pour toi et ne modifie pas GitHub.

```sh
okb ticket github setup --repository acme/orders --host github.com --allowed
okb ticket github 17 --repository acme/orders --ticket ABC-123
```

La commande de configuration remplace la liste complète des dépôts autorisés : indique toute la liste si tu en autorises plusieurs (`--repository acme/orders,acme/billing`). Respecte les règles de ton entreprise ; si cette lecture n’est pas autorisée, garde les états déclarés à la main.

Pour Jira, tu peux conserver une observation que tu as lue toi-même, avec son adresse et sa date. Elle sera affichée **déclarée** ; OKB n’a pas contacté Jira.

```sh
okb ticket jira --ticket ABC-123 --status "En revue" --url https://issues.example.test/browse/ABC-123 --observed-at 2026-10-11T10:00:00Z
```

Les anciens suivis JSON sont importés une seule fois dans l’état SQLite privé. Leurs fichiers restent intacts comme archives ; le suivi actuel se sauvegarde ensuite avec la base SQLite. Évite d’alterner une ancienne version et la nouvelle sur le même profil : l’archive JSON n’est plus actualisée.
