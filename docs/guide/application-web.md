# L’application web

```bash
okb serve
```

La page s’ouvre dans ton navigateur (`http://127.0.0.1:4317`). Elle ne tourne que
sur ton ordinateur : aucun compte, aucun service en ligne. Arrête-la avec Ctrl+C
dans le terminal. Autre port : `okb serve --port 4318` ; sans ouvrir le
navigateur : `okb serve --no-open`.

![Accueil de l’application web](../images/web-home.png)

## Ce que tu y trouves

Tout ce que fait le terminal se fait aussi dans la page.

| Rubrique | Pour |
|---|---|
| **Accueil** | ce qui t’attend, ce qui est utile maintenant, ta dernière session, une capture rapide |
| **Notes** | lire tes notes, colorées par catégorie : tableaux, schémas Mermaid, encadrés, notes de bas de page, « cité par » et « liens vers », graphe local, sommaire ; ouvrir dans Obsidian |
| **Graphe** | toutes les notes et leurs liens, une couleur par catégorie ; zoom, filtres, voisinage d’une note ([détails](graphe-et-categories.md)) |
| **Repos** | les repos de code documentés : carte, notes, questions, fraîcheur ([détails](repos.md)) |
| **Rechercher** | mots, alias, passages exacts |
| **À relire** | les propositions : changements fichier par fichier, aperçu, citations des sources ; approuver, appliquer, écarter |
| **Inbox** | trier tes captures : marquer comme traitée, jeter, ou demander à Claude d’en faire une note |
| **Focus et journal** | écrire ton focus, finir une session, relire le journal |
| **Revue de la semaine** | la revue guidée, étape par étape |
| **Réviser** | des cartes tirées de tes fiches concepts |
| **Santé** | le score de la KB, les problèmes expliqués, rafraîchir les index |
| **Historique** | chaque changement appliqué ; annuler le dernier |
| **Ajouter une source** | un fichier ou une adresse web |
| **Procédures → skills** | transformer une procédure en skill Claude |
| **Modèles et style** | les modèles de notes et ton style d’écriture |
| **Réglages** | langues, style, aide aux notions, focus, Git, cohabitation avec d’autres outils |
| **Diagnostic** | tout vérifier, réparer, mettre à jour OKB |
| **Aide** | glossaire, raccourcis, codes d’erreur, visite guidée |

En haut à gauche, le sélecteur de KB : passer d’une KB à l’autre, en créer une.
En bas : thème clair ou sombre, langue (FR/EN).

![Lire une note](../images/web-note.png)

## Raccourcis

- **⌘K** (ou **/**) : chercher une note ou aller n’importe où.
- **⌘↵** : capturer depuis le champ de l’inbox.

## Relire et approuver

![Relire une proposition](../images/web-review.png)

Ouvre une proposition dans « À relire » : chaque fichier montre ses lignes
ajoutées et retirées. Décoche ce que tu ne veux pas garder, puis :

- **Approuver et appliquer** : les changements entrent dans ta KB (et un commit
  Git est créé si l’historique est actif) ;
- **Approuver seulement** : pour appliquer plus tard ;
- **Écarter** : la proposition est abandonnée, ta KB ne change pas.

Pour approuver, OKB vérifie que c’est bien **toi** : sur macOS, une fenêtre de
confirmation apparaît sur ton écran ; ailleurs, la question est posée dans le
terminal où tourne `okb serve`. Un programme ou un agent qui piloterait la page ne
peut pas répondre à ta place. Si aucune des deux n’est possible, la page affiche la
commande à lancer toi-même (`okb review 1`).

Si ta KB a changé depuis la préparation de la proposition (tu as modifié une note
dans Obsidian, par exemple), la page refuse l’aperçu : la proposition doit être
préparée à nouveau. Tes modifications ne sont jamais écrasées.

## Réglages

![Réglages](../images/web-settings.png)

Chaque réglage est enregistré tout de suite et s’applique sans redémarrer.
La valeur recommandée porte une ★. Le nom technique (par exemple
`writing.language`) est le même que dans `okb settings`.

## En mode sombre

![Accueil en mode sombre](../images/web-home-dark.png)

## Sécurité, en bref

La page n’écoute que ton ordinateur, refuse les requêtes venant d’autres sites et
n’exécute jamais le contenu de tes notes. Les détails sont dans
[la documentation technique](../dev/WEB-APP.md).
