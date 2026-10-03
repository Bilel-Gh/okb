# Consulter OKB dans le navigateur

`okb serve --profile <id>` ouvre un serveur de lecture local sur
`http://127.0.0.1:4317`. Copier cette adresse dans le navigateur ; arrêter le
serveur avec Ctrl+C. Aucun compte, service distant ou paquet supplémentaire.

```bash
okb serve --profile moi
okb serve --profile moi --port 4318   # si le premier port est occupé
```

La vue d’ensemble indique les connaissances intégrées et les propositions en
attente. « Mes connaissances » lit les notes de la KB. La recherche réutilise
`pipeline/ask.ts` : mots, alias, passages et numéros de lignes, sans appel au modèle.
« Mon style » affiche les préférences et le brief. « Santé de la KB » lance
l’audit des notes et des liens, sans lire les fichiers sources d’origine.

## Relire avant d’intégrer

« À relire » affiche les propositions préparées du profil sélectionné. Chaque
fichier dispose d’un diff et d’un aperçu lisible, construit par le même
`materializeFile` que le CLI. Les liens entre fichiers d’une même proposition
permettent de parcourir les articles avant leur création. Les extraits sources,
les dépendances et l’empreinte du contenu sont consultables.

L’interface affiche les commandes d’approbation et d’application à exécuter
soi-même dans le terminal. Elle ne signe aucune approbation et ne modifie aucune
note ou proposition. Pour sélectionner certains changements, utiliser le CLI
avec `okb review <id> --only <ids>` puis approuver cette sélection exacte.

Une proposition dont la KB de départ a changé est signalée comme périmée : son
diff n’est pas recalculé sur le nouveau texte. Il faut la reconstruire, puis la
relire. Le contrôle définitif se fait toujours au moment d’approuver et d’appliquer.

## Périmètre et limites

- Le serveur écoute uniquement sur `127.0.0.1`. Le Host exact et les origines
  navigateur sont contrôlés ; aucune route d’écriture, clé d’approbation ou
  configuration complète n’est exposée.
- Les notes et diffs restent des données : HTML source et images ne sont pas
  exécutés ni chargés. Aucun asset externe, analytique ou CDN.
- Le lecteur affiche les titres, paragraphes, listes, liens et blocs de code.
  Tables complexes, notes de bas de page et Mermaid restent en Markdown lisible.
  Utiliser Obsidian pour leur rendu complet ; le texte exact reste accessible.
- Le profil est chargé au démarrage. Après modification de ses préférences,
  redémarrer le serveur. « Actualiser » relit les notes et les propositions.
- La recherche affiche jusqu’à 15 résultats ; le CLI permet de lire les pages
  suivantes avec un curseur. Une absence de résultat ne prouve pas une absence
  de connaissance.
- Un programme exécuté sous le même compte utilisateur peut accéder au service
  local. Ce lecteur n’est pas conçu comme service multiutilisateur ou serveur LAN.

Implémentation : `src/web/serve.ts`, `src/web/ui.ts`, `tests/web.test.ts`.
