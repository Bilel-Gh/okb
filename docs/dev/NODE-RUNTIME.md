# Node : CLI, compilation et application desktop

Le minimum déclaré reste **22.13.0**. OKB ne remplace pas `node:sqlite` par une
dépendance native et n’abaisse pas `engines` pour contourner un avertissement.

## API effectivement employée

`src/state/db.ts` utilise `DatabaseSync` avec un chemin string et l’option
`readOnly`, `exec`, `prepare`, `close`, puis `StatementSync.run/get/all` avec des
paramètres positionnels. Ces API figurent dans la
[documentation de Node 22.13.0](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html).
Le moteur n’emploie ni `backup()`, ni `aggregate()`, ni `location()`, ni les
options de timeout ajoutées plus tard : `busy_timeout`, WAL, foreign_keys et
`VACUUM INTO` sont des requêtes SQLite. L’historique officiel situe l’arrivée de
SQLite en 22.5 et le retrait du flag `--experimental-sqlite` en 22.13 ; l’API
reste expérimentale dans cette branche. Voir
[l’historique SQLite de Node 22](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html).

## Dépendances verrouillées et compilation

Le contrôle des champs `engines.node` de tous les paquets du lockfile, production
et développement, ne trouve aucune exclusion de 22.13.0. En particulier :
`unpdf` 1.8.1 demande Node >=22 ; Vite 8.3.3 demande ^20.19 ou >=22.12 ;
Vitest 4.1.11 accepte la branche 22 ; le paquet Electron 44.7.0 demande >=22.12.
Cela vérifie leurs déclarations, pas tous leurs chemins d’exécution.

La compilation et les contrôles de cette itération utilisent Node **24.19.0**.
`scripts/check-node-runtime.mjs` exerce les migrations, paramètres SQL,
transaction annulée, sauvegarde et lecture en mode readOnly dans /tmp. Un essai
de toute la suite avec le binaire exact 22.13.0 n’a pas été effectué ici.
Le Node 20 présent dans le shell n’est pas le runtime compatible de la CLI.

## Desktop

La personne qui reçoit le programme desktop utilise le Node embarqué dans
Electron ; elle n’a pas à installer Node pour son état SQLite. Un mainteneur qui
compile le programme depuis les sources a besoin du runtime de compilation.

Le même script a été exécuté avec **Electron 44.7.0, Node 24.21.0, SQLite
3.53.4** en mode `ELECTRON_RUN_AS_NODE=1`, depuis une extraction temporaire du
cache existant. Aucun installateur ni profil personnel n’a été utilisé. Les
migrations, paramètres SQL, rollback, sauvegarde et contrôle d’intégrité
passent. Le contrôle CLI utilise SQLite 3.53.3 sous Node 24.19.0.
Ces essais ne qualifient pas le lancement d’une fenêtre packagée, la signature,
les mises à jour ou Windows. Ils vérifient la compatibilité du moteur avec le
runtime effectivement embarqué.
