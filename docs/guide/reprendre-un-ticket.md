# Reprendre un ticket

Dans le module Développeur, chaque ticket a **une seule fiche** (F2.4-08, D70).
L'accueil, la liste des tickets, le terminal, l'assistant et le brief de début
de session lisent cette même fiche : ils ne peuvent plus se contredire.

## La fiche en un coup d'œil

- **L'en-tête** donne la référence, le lien vers sa source (Jira, ServiceNow…),
  les repos, la branche et le **vrai titre**. Sans titre connu, la fiche affiche
  « Titre non défini » plutôt que de répéter la référence.
- **L'anneau** dit combien la fiche est renseignée, par exemple « 70 % » : c'est
  ce qu'on sait du ticket pour le reprendre, pas l'avancement du travail. Dix
  rubriques comptent autant : titre, problème, description, critères, statut
  source, équipe et produit, ce qui est fait, prochaine étape, blocage, repo.
- **Le parcours** tient en une ligne : compris, travail, PR, CI, livraison. Une
  étape faite est verte, celle en cours entourée, une attente en orange, un état
  inconnu en pointillé avec « + Déclarer ».
- **En 30 secondes** répond à quatre questions : le problème, ce qui est déjà
  fait, ce qui reste, ce qui bloque.
- **Détails** regroupe le statut source, l'équipe, le produit, les repos, la PR
  et les critères.

## Tout se modifie à la main

Clique sur un texte pour le corriger, ou sur « + Ajouter » quand un champ n'est
pas défini. Chaque valeur garde son **origine** (toi, l'agent, Jira, ServiceNow,
wiki) et sa date. Une valeur que tu as écrite n'est **jamais remplacée** par
l'agent : si une source dit autre chose, la fiche te montre les deux valeurs et
tu choisis. Rien n'est inventé : une valeur vide, « inconnu » ou la simple
référence est refusée, le champ reste non défini.

Le menu « … » permet de renommer, de changer le lien source, de copier le
prompt « compléter ce ticket », d'épingler le ticket sur l'accueil ou
**d'arrêter de le suivre**. Ses notes restent alors dans ta mémoire, et une
copie de la fiche est gardée 30 jours : `okb ticket restore ABC-123` l'annule.

## La prochaine étape est ta première todo

La prochaine étape n'est plus un champ à part (F2.4-13) : c'est la todo ouverte
épinglée, sinon la plus importante, puis la plus ancienne. Coche-la, la suivante
prend sa place. L'importance se lit en une à trois barres (basse, moyenne par
défaut, haute) ; un clic la change. Dans le champ d'ajout, `!` en tête donne
l'importance haute ; sur l'accueil, `#ABC-123` rattache la todo au ticket.

## Demander à l'agent

OKB ne se connecte ni à Jira, ni à ServiceNow, ni à un wiki. Ton agent (Claude
Code avec ses outils MCP) le peut. « Demander à l'agent » sur un champ, ou
« Compléter avec l'agent » pour tout ce qui manque, enregistre **une demande**
et copie un prompt prêt à coller (F2.4-10). Au début de ta prochaine session
dans le repo, l'agent voit la demande, lit seulement ce que ses outils
permettent, remplit chaque valeur avec son origine et son lien, puis rend compte
de ce qu'il a trouvé et de ce qu'il n'a pas pu lire. Il ne modifie jamais Jira
ni ServiceNow.

## Les notes du ticket

Toutes les notes d'un ticket apparaissent sur sa fiche, où qu'elles soient
rangées (F2.4-11) : celles qui déclarent `tickets: [ABC-123]` dans leurs
métadonnées, celles qu'OKB a écrites pour ce ticket, et celles que tu lies à la
main. Une note qui cite seulement la référence est **suggérée** : « Lier » ou
« Écarter » ; une suggestion écartée ne revient pas. Une note qui documente un
ticket qu'OKB ne suit pas encore ouvre une fiche « Documenté, pas suivi »
avec « Suivre ce ticket ».

Le travail, la PR et sa revue, les vérifications, l’attente et la livraison ont chacun leur état. **Inconnu** veut dire que tu n’as pas encore cette information. Une PR fusionnée ne confirme pas une livraison en production ; chaque environnement se suit séparément.

Avant de terminer, relis les tests, la documentation, la recette et la confirmation. Rends obligatoires les critères dont ton ticket a besoin. Ils doivent être satisfaits ou explicitement écartés avant de clôturer le travail. Ces cases ne lancent aucun test à ta place.

Une piste échouée se note avec ses conditions : ce qui a été essayé, dans quel contexte et ce qui s’est passé. **Réutiliser une note** garde la révision qui t’a aidé sur ce ticket. Dans **Aujourd’hui**, les notes qui citent du code modifié apparaissent à revérifier ; ouvre leur source avant de proposer une correction.

Le terminal propose le même suivi, sans IA :

```sh
okb ticket sheet ABC-123
okb ticket set ABC-123 --field team --value "Équipe Paiement"
okb ticket na ABC-123 --field criteria --reason "investigation sans recette"
okb ticket rename ABC-123 "Le panier perd les remises"
okb ticket links ABC-123 add methodo/cas-remises.md
okb ticket requests list
okb action add "Vérifier la confirmation" --ticket ABC-123 --importance high
okb action edit <identifiant> --text "Vérifier la page de confirmation" --pin
okb action delete <identifiant>
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

Un ticket commencé avant OKB se reprend avec **`/okb-dev:ticket`** dans Claude
Code, ou avec une commande locale :

```sh
okb ticket resume ABC-123 --repo orders-service --ticket-file /tmp/ticket.txt --json
```

Le repo détermine le profil autorisé. La commande normalise `abc_123` en
`ABC-123`, cherche le suivi SQLite et les notes de ticket de ce profil, puis
réconcilie les deux. Une référence dans une simple citation du corps d'une note
n'en fait pas une fiche de ticket. Plusieurs notes possibles exigent
`--note <chemin>` ; plusieurs références ou profils exigent le choix concerné.
Sur une branche portant une seule référence, `okb ticket resume --json` suffit.
`start` reste disponible et suit le même parcours. `brief` reste la commande
pour corriger explicitement le problème (`--goal`), ce qui est fait
(`--last-action`) ou la prochaine étape (`--next`, qui devient la todo épinglée).

Une note seule recrée le suivi local, garde sa révision comme source et complète
les champs vides connus. Un suivi seul prépare une note à relire, avec les
informations disponibles et les inconnues explicites. Le texte initial et les
corrections humaines restent en place ; les valeurs contradictoires sont
renvoyées dans `conflicts`. Les nouvelles informations textuelles vont au journal
une seule fois. Relancer une demande identique ne crée pas de nouvel événement
ni de proposition. Une proposition écartée est renvoyée comme telle, sans être
réactivée. La note proposée reste un brouillon déclaratif : ni vérité confirmée,
ni preuve que les tests ou la livraison ont eu lieu.

Pour apporter plusieurs faits à la fois, l'opération commune `tickets.resume`
(API `/api/tickets/resume`, MCP) accepte `context`, `decisions` (texte et raison),
`attempts` (approche, conditions, résultat, suite), `criteria`, `sources` et
`waiting`. La commande du terminal conserve les gestes courts ci-dessus. Sans
conversation disponible ou connecteur configuré, OKB ne prétend pas retrouver
leur contenu. Un ticket multi-repos se rattache par une invocation explicite par
repo ; les notes et états des différents profils ne sont pas fusionnés.

Si la note existe, de nouveaux faits préparent un complément à relire qui garde
son contenu humain intact. Le diff et les conflits rendent visible ce qui est
ajouté. Une modification de la note après préparation bloque l'application du
complément. Dans un cerveau, Claude doit nommer la suggestion déjà acceptée
avec `--suggestion <id>` ; sans cet accord, la reprise locale reste utilisable et
`proposalDeferred` explique pourquoi aucune note n'a été préparée. Cela ne
remplace jamais ton approbation finale.
