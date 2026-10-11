# Projets, actions et journal : garder le fil

Un projet, c'est ce sur quoi tu travailles : un cours, une mission, un événement.
Avec le module développeur, tes tickets et tes repos sont des projets tout seuls.
OKB s'en sert pour te dire, chaque matin, par où reprendre.

## Un projet

Dans l'application : **Projets › Nouveau projet**. Dans un terminal :

```bash
okb project new "Sortie de juin"
```

Chaque projet dit deux choses, que tu écris en une ligne :

- **où on en est** ;
- **la prochaine étape**.

```bash
okb project set "Sortie de juin" --where "Le car est réservé" --next "Envoyer les autorisations"
okb project                      # tes projets en cours
okb project show "Sortie de juin"
okb project set "Sortie de juin" --status done
```

Un projet se désigne par son titre, son identifiant (`P-1a2b3c`) ou, pour un
ticket, sa référence (`ABC-231`).

## Les actions et ce que tu attends

Sur la page d'un projet, ou dans **Aujourd'hui** :

- **À faire** : coche une action quand elle est faite. Elle laisse une ligne dans
  le journal du projet.
- **En attente de quelqu'un** : ce que tu attends, et de qui.
- **Questions ouvertes** : ce à quoi il faudra répondre.

OKB lit la ligne que tu tapes. « réserver le car avant le 15 mai » devient
l'action « Réserver le car », avec sa date. « l'avis de Paul sur la PR », tapé
dans « En attente », est noté comme attendu de Paul. Il comprend demain, lundi,
le 15 mai, 3/11, en français et en anglais, sans IA.

```bash
okb action add "réserver le car avant le 15 mai" --project "Sortie de juin"
okb action add "j'attends l'accord de Paul" --project "Sortie de juin"
okb action                       # ce qui est ouvert, les retards d'abord
okb action done A-1a2b3c
```

## Le journal

Le journal dit ce qui s'est passé, jour par jour et projet par projet : une note,
une décision, une chose faite, un essai raté, une réunion.

```bash
okb journal add "On garde PostgreSQL" --project "Cache des sessions" --kind decision
okb journal --project "Cache des sessions"
okb journal --days 7             # la semaine, avec les notes écrites et les tickets
```

Les types de ligne : `note`, `decision`, `done` (fait), `tried` (essayé, sans
succès), `meeting`. Avec le module développeur, les décisions et les commits d'un
ticket apparaissent dans le journal de son projet.

Un jour, c'est ton jour à toi : une ligne écrite à une heure du matin est rangée
au jour où tu l'écris.

## « Où j'en étais »

Quand tu quittes un projet, clique **Je quitte le projet** (ou `okb project leave
"Sortie de juin"`). OKB prépare quatre lignes à partir du journal et des actions
depuis la dernière fois :

| Ligne | D'où elle vient |
|---|---|
| Fait | les actions cochées et les lignes « fait » du journal |
| Essayé | les lignes « essayé, sans succès » |
| En attente | ce que tu attends encore, et de qui |
| Par où reprendre | la prochaine étape du projet, sinon la première action ouverte |

Tu corriges une ligne si besoin ; OKB note que c'est toi qui l'as corrigée. Au
retour, tu retrouves ces lignes en haut du projet et dans Aujourd'hui.

## Aujourd'hui

L'écran **Aujourd'hui** (ou `okb today`) répond à six questions :

| Question | Ce que tu vois |
|---|---|
| Je reprends quoi ? | tes projets en cours, celui que tu as quitté en dernier d'abord, avec « Où j'en étais » |
| J'ai quoi à faire ? | tes actions ouvertes, les retards d'abord |
| J'attends quoi ? | ce que tu attends de quelqu'un |
| Qu'est-ce qui s'est passé ? | le journal d'aujourd'hui et d'hier |
| Qu'est-ce que j'ai appris ? | les notes entrées dans ta mémoire cette semaine |
| Que dois-je revoir ou comprendre ? | tes cartes à réviser, et une fiche concept que tes notes utilisent et que tu n'as jamais ouverte |

## Les documents d'un projet

La zone **Documents** d'un projet garde ses fichiers tels quels : un devis, un
plan, un compte rendu. **Garder un fichier** le relie au projet, et une ligne du
journal le note. Voir [les documents](documents.md).

## Garde ça

**Garde ça** (⌘J), en haut de chaque écran : tape une ligne.

- Sans projet, elle va dans tes captures, à ranger quand tu veux.
- Avec un projet choisi, elle va dans le journal de ce projet.
- Si OKB y repère une action, il te propose de la créer aussi ; tu décoches si
  tu n'en veux pas.

Ce que tu écris toi-même est gardé tout de suite : seul ce que l'IA rédige attend
ton oui.

## Où c'est rangé

Les projets, les actions et le journal ne sont pas des notes. Ils vivent dans une
petite base SQLite, dans le dossier d'état de ton profil (`okb.db`), hors de tes
notes et hors de tout dossier synchronisé. Tes notes restent en Markdown, lisibles
sans OKB.
