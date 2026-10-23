# Version 2.4.0 — Le quotidien du dev

> **« Je reprends un ticket en moins d’une minute, et ma mémoire se range
> pendant que je travaille. »** La 2.4 part d’une semaine d’usage réel au travail.
> Rien ne quitte ton ordinateur ; rien n’entre dans une note validée sans ton oui.

## En bref

- **Une seule fiche par ticket** (lot A) : le vrai titre, ce qui est fait, ce qui
  reste, ce qui bloque ; tout se modifie à la main ; chaque valeur garde son
  origine ; ton agent complète la fiche depuis Jira, ServiceNow ou le wiki.
- **Valider en un geste** (lot E) : l’agent range la note que tu demandes, déjà
  utilisable, marquée « à relire » ; tu tries le soir dans un seul écran, sans
  fenêtre système ni commande ; le pourcentage de notes validées mesure
  l’entretien de ta mémoire.
- **Une carte qui dit vrai, et l’équipe responsable** (lot D) : seuls les vrais
  systèmes sont sur la carte, chaque relation dit sa certitude et se corrige ;
  chaque repo et chaque produit a son équipe responsable.
- **Les todos de l’agent** (lot B) : il en ajoute au ticket, coche et règle
  l’importance ; une todo que tu retires ne revient jamais.
- **Un accueil qui raconte la journée, et une app plus rapide** (lot C) : les
  cinq faits marquants depuis hier ; l’app s’ouvre et change de page plus vite.

## Le suivi d’un ticket

- Une fiche unique, lue par l’accueil, la liste, le terminal, l’assistant et le
  brief de session (F2.4-08, D70). La prochaine étape est ta première todo
  (F2.4-13).
- Tout se modifie là où on le lit ; une valeur que tu as écrite n’est jamais
  écrasée, un écart avec une source se choisit en un clic (F2.4-09).
- « Demander à l’agent » : une demande lue au début de la session suivante ; il
  lit ce que ses outils permettent et dit ce qu’il n’a pas pu lire (F2.4-10).
- Les notes d’un ticket apparaissent sur sa fiche où qu’elles soient rangées
  (F2.4-11) ; « Contexte renseigné : N % » (F2.4-12) ; équipe et produit (F2.4-14).
- Préparé le 11 octobre : brief corrigible, états séparés (travail, PR, CI,
  attente, livraison par environnement), critères de fin, mémoire des essais avec
  leurs conditions, notes à revérifier après tes commits, lecture explicite d’une
  PR GitHub par ta session `gh` (F2.4-01 à F2.4-07).

## Tes notes, rangées pendant que tu travailles

- Un réglage par KB, que toi seul changes : « Rien n’entre sans mon oui » (par
  défaut) ou « L’agent range directement, je relis après » (F2.0-52, D71).
- L’écran « À relire » : Oui, Non, Changer l’emplacement (les liens suivent),
  Faire relire, Oui à tout ; touches O et N (F2.0-55).
- `okb serve` reconnaît la page qu’il ouvre : approuver et trier se font sans
  fenêtre système ni terminal (F2.0-56).
- La part de notes validées, discrète sur l’accueil et dans la barre d’état
  (F2.0-57).

## La carte et les équipes

- Une adresse écrite dans le code n’est plus une relation : registres, hébergeur
  Git, liens de documentation et polices sont rangés dans « Pas sur la carte »
  (F2.4-15, D72).
- Un seul moteur pour la carte, la page Repos, le brief et MCP ; chaque relation
  dit sa certitude et sa raison, et tes corrections survivent aux scans
  (F2.4-16 à F2.4-18).
- L’équipe responsable d’un repo ou d’un produit, avec son origine ; ton agent
  peut la chercher (F2.4-19, F2.4-20, D73).

## Les todos et l’accueil

- Une todo de l’agent entre directement, avec sa raison ; il ne réécrit et ne
  retire que les siennes ; une todo retirée ne revient pas, « Annuler » la remet
  (F2.4-21 à F2.4-24, D74).
- « Ce qui s’est passé » : cinq faits marquants depuis hier, chacun avec son
  contexte (F2.4-25, D75).
- Les fichiers de l’app restent en cache, la mémoire est lue dès le démarrage,
  les pages principales sont préchargées (F2.4-26).

## Passer de la 2.0

Tes notes ne sont jamais réécrites. Au premier lancement, la base d’état locale
est copiée dans les sauvegardes, puis mise à jour (migrations 7 à 11). Tes notes
existantes approuvées ou écrites par toi sont « validées » ; celles générées sans
trace d’approbation sont « à relire ». Le réglage d’écriture reste « Rien n’entre
sans mon oui » tant que tu ne le changes pas.

Cette version contient aussi les préparations 2.1 à 2.3 (partage à deux,
comprendre et apprendre, assistant local) décrites dans leurs propres notes ;
l’application de bureau de la 3.0 reste un aperçu.

## Limites

- OKB ne contacte ni Jira, ni ServiceNow, ni un wiki : c’est ton agent qui lit,
  avec ses propres accès.
- La clé de la page passe en argument de la commande qui ouvre le navigateur, et
  ne protège pas d’un logiciel qui piloterait ta souris.
- Le plafond de trois todos par session est une conduite de l’agent.
- Non vérifié par les tests : une connexion GitHub réelle, une reprise en moins
  d’une minute au quotidien, un mois sans oubli de livraison.

Guides : [reprendre un ticket](../guide/reprendre-un-ticket.md) ·
[valider les notes](../guide/valider-les-notes.md) · [les repos](../guide/repos.md).
Notes d’usage : [19 octobre](RELEASE-USAGE-2026-10-19.md) ·
[22 octobre, notes](RELEASE-USAGE-2026-10-22.md) ·
[22 octobre, carte](RELEASE-USAGE-2026-10-22-lot-d.md) ·
[23 octobre](RELEASE-USAGE-2026-10-23.md).
