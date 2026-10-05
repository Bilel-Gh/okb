# Version 0.10.0

Cette version fait des repos d'une équipe un **espace de travail** : une seule KB,
un espace par repo et une partie commune. OKB se concentre tout seul sur le repo et
le ticket dont tu parles. Tout est générique : aucun nom de dossier ni
d'organisation n'est supposé.

- **Les KB restent locales.** OKB ne met plus aucune KB sous Git :
  - aucun commit, aucun remote, plus d'étape GitHub ni de `git push` ;
  - l'annulation repose sur ses propres sauvegardes ;
  - une KB que tu versionnes toi-même reste sous Git, mais OKB n'y fait plus
    aucun commit.
- **Trois types de KB**, choisis à la création :
  - 📚 sujet ;
  - 📦 repo, ses notes à la racine ;
  - 🗂️ espace de travail.

  `okb repo add` conseille selon le contexte :
  - des repos à côté → créer l'espace ;
  - un repo seul → sa KB ;
  - un repo dans un espace → la KB de l'espace.

  Une KB de repo peut vivre dans son repo, dans un dossier que Git ignore sur cet
  ordinateur seulement (`--in-repo`).
- **Repo rattaché.** Un repo qui a sa propre KB dans un espace garde ses notes et
  reçoit la partie commune de l'espace :
  - le résumé de départ et `okb ask` lisent les deux KB ;
  - la fin de ticket écrit ce qui est commun dans la KB de l'espace (`--to-kb`).

  `okb workspace attach | detach` sert pour un repo rangé ailleurs.
- **Fusion.** `okb kb merge <KB du repo> --into <KB de l'espace>` :
  - une proposition range toutes ses notes sous `repos/<repo>/`, les liens restent
    valides ;
  - une fois appliquée, la même commande déplace le suivi du repo et ses tickets ;
  - l'ancien dossier reste intact.
- **Le graphe d'un espace.**
  - Une vue d'ensemble : une bulle par repo et par dossier commun, les appels
    entre repos d'après le code, le repo du périmètre entouré.
  - Dans la vue Notes, un choix « Périmètre » met en avant un repo, ses notes
    communes et ses voisins.
  - Les tickets ont leur propre catégorie 🎫.
- **Conseils.** Claude ouvert à la racine d'un espace sans repo nommé demande
  lequel, et rappelle qu'ouvrir le dossier du repo est le plus simple. Une page
  de guide explique le choix et la marche à suivre pour un premier ticket.
- **`okb workspace add <dossier>`** enregistre chaque repo du dossier (jusqu'à
  deux niveaux) et en dresse la carte, sans IA. Il apprend le format de vos
  tickets d'après les branches et prépare la carte des liens entre repos. Des
  repos éparpillés : `--to <espace>` ajoute un autre dossier. Dans Claude Code :
  `/okb:workspace`.
- **Le périmètre.** Claude Code ouvert dans un repo, ou à la racine de l'espace
  quand tu nommes un repo ou un ticket (« j'ai le ticket ABC-123 sur
  orders-service ») : OKB bascule. Claude reçoit alors un brief court :
  - les notes du repo ;
  - les notes communes liées ;
  - les repos voisins ;
  - le ticket en cours.

  À la main : `okb scope <repo | ABC-123 | off>`. La ligne d'état affiche
  `📦 repo · 🎫 ticket`.
- **La recherche suit le périmètre.** `okb ask` classe d'abord les notes du repo,
  puis les notes communes liées, et les autres repos en dernier. `--everywhere`
  cherche partout.
- **Un ticket suivi sans IA** (`okb ticket start | note | done | list`) :
  - son point de départ ;
  - sa branche, reconnue à son nom ;
  - ses commits, gardés même après un squash ;
  - un journal des décisions, pièges et questions.

  Après un commit fait dans Claude Code, un rappel d'une ligne. Après un merge,
  la session suivante propose d'écrire la note.
- **`/okb:ticket` écrit à deux niveaux :**
  - l'espace du repo : note du ticket, carte du code, notes modifiées ;
  - la partie commune : règle métier, fiches de termes, guide d'une
    fonctionnalité qui traverse plusieurs repos, carte des liens.

  Une note commune complétée depuis un repo reste commune.
- **Confidentialité du dépôt.** Les mots propres à une organisation ne sont plus
  dans les tests : chacun les liste dans `.dev/private-leaks.txt`, ignoré par Git.
  Le test les cherche dans tous les fichiers, fixtures comprises.
- Guides : [Choisir son organisation](../guide/choisir-son-organisation.md) et
  [Plusieurs repos : l'espace de travail](../guide/espace-de-travail.md).
  Décisions : D32, D33, D34.

Vérification : `npm run release:check`. Nouveaux tests :
- un espace fictif de trois repos, de la bascule par message jusqu'aux faits du
  ticket après merge ;
- le classement par périmètre ;
- la lecture des références de tickets et des noms de repos ;
- une KB sans Git, même quand la personne la versionne elle-même ;
- une KB de repo à plat, hors du repo ou dedans, ignorée par Git ;
- le conseil au moment d'enregistrer un repo ;
- un repo rattaché (résumé et recherche sur deux KB), puis sa fusion ;
- les données du graphe d'un espace.
