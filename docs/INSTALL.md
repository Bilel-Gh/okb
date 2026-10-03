# Installation, mise à jour et profils

## Installation propre

Node 22.12+ et npm sont nécessaires. Le plugin vise Claude Code ; le fichier de
manifest peut être vérifié avec `claude plugin validate ./plugin`. Le chargement
local utilise `claude --plugin-dir "$PWD/plugin"`. Les évaluations natives livrées
nécessitent une version qui expose `claude plugin eval` (voir EVALUATION.md).

```bash
npm ci
npm run release:check
npm link
```

`npm ci` utilise le verrouillage du dépôt. `npm pack` fabrique un paquet compilé
installable via `npm install -g /chemin/okb-0.2.0.tgz`. Le plugin reste dans ce paquet ;
avec une installation globale, son emplacement est `$(npm root -g)/okb/plugin`.
Les chemins du plugin n’assument jamais l’emplacement de ta KB.

Le test d’installation utilise un corpus fictif dans un dossier temporaire.
Pour configurer ton propre dossier, qui doit exister :

```bash
okb setup --profile moi --kb-root /chemin/vers/notes --concept-assist targeted \
  --human-actor human:moi --answer-language fr --locale fr-FR
okb doctor --profile moi
```

Ou copier [onboarding.yaml](../examples/onboarding.yaml), le compléter hors du
dépôt et utiliser `okb setup --from /chemin/prive/onboarding.yaml`.
Les options explicites priment sur ce fichier. Le niveau d’aide aux concepts est
obligatoire au premier setup. La skill le demande une fois si aucun choix n’a été
fourni, sans redemander les paramètres connus.

## Préférences et politiques

`OKB_HOME` vaut `~/.okb` par défaut. Les profils sont sous `profiles/<id>/`.
`okb setup switch <id>` change le profil actif ; `--profile` choisit celui d’une
commande et prime sur `OKB_PROFILE`. Refaire setup conserve les valeurs non
remplacées et les clés personnalisées ; le YAML du profil peut être reformaté.

Les couches sont defaults → org → team → profil → KB-local → environnement → flags.
`orgConfig` et `teamConfig` peuvent désigner des fichiers privés ; les variables
`OKB_ORG_CONFIG` et `OKB_TEAM_CONFIG` permettent de les fournir sans toucher le profil.
Un fichier déclaré absent bloque la configuration au lieu d’effacer la politique.
Une KB-local `.okb/kb.yaml` ne peut pas rediriger la racine, l’identité ou l’état.
Les politiques de toutes les couches s’intersectent ; les exclusions s’additionnent.

Exemples génériques : [org-policy.yaml](../examples/org-policy.yaml) et
[team.yaml](../examples/team.yaml). `okb config show --json` indique les couches,
valeurs effectives, restrictions appliquées et clés inconnues conservées mais inactives.
`okb config show --defaults` présente le schéma complet ; ce n’est pas le format
simplifié de `setup --from`.

Pour les concepts, modifier `conceptAssist.level`, `byDomain`, `known`, `deepen`,
`fundamentals`, `stoplist` et les limites dans le profil. Une désactivation ne
supprime pas les anciennes fiches ou les liens existants. Le choix ponctuel
`--concept-assist off` n’affecte que cet import.

## Mise à jour depuis 0.1

Conserver une copie de la KB et du dossier d’état avant le changement de version.
Installer le nouveau code puis refaire `doctor` ; ne pas réinitialiser le profil.
Cette version corrige le contrat de hash et les reçus : **les anciennes propositions
et approbations doivent être recréées**, elles ne sont pas réautorisées implicitement.
Les anciens reçus/sauvegardes sont conservés, mais leur restauration automatique
n’est pas compatible avec le nouveau moteur. Une ancienne opération interrompue
exige une inspection des fichiers et sauvegardes avant toute reprise.

`nav`, `links move` et `migrate portable-links` préparent désormais des propositions.
L’ancien `--write` ne les applique pas directement. `--section-file` est remplacé
par `--analysis-file`, qui porte couverture et preuves. Voir WORKFLOWS.md.

## Désinstaller

Retirer le chargement du plugin de Claude puis `npm uninstall -g okb` (ou
`npm unlink -g okb` pour une installation liée). Cela retire le produit, pas les
profils, l’état ni la KB. Ne pas supprimer l’état si tu veux garder le rollback.
Le produit ne crée ni dépôt, ni remote, ni commit, ni push.
