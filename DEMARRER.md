# Démarrer avec OKB

OKB est un second cerveau local pour Claude Code et Obsidian : Claude lit tes
sources et rédige, OKB vérifie chaque phrase contre une citation exacte, et rien
n’entre dans tes notes sans ton accord.

## 1. Installer (5 minutes)

Il te faut Node.js 22.12 ou plus récent. Depuis le dossier d’OKB :

```bash
./scripts/install.sh
```

L’assistant pose une question à la fois, avec une réponse recommandée (★) :
le nom de ta KB, son dossier, les langues (celle d’OKB et celle des notes), le
style d’écriture, l’historique Git, le plugin Claude et la commande `okb`.
Il ne modifie ni tes réglages Claude ni tes fichiers de shell.

Détails, mise à jour et désinstallation : [installer](docs/guide/installer.md).

## 2. Découvrir

```bash
okb tour       # 2 minutes, sur une KB jetable : capture, source, relecture, annulation
okb            # le menu : ce qui t’attend et quoi faire ensuite
okb serve      # l’application web
```

## 3. Au quotidien, avec Claude

Parle normalement. OKB reconnaît ce que tu demandes et propose de s’en occuper :

- « lis ce transcript » → il prépare des notes sourcées que tu relis ;
- « note ça : … » → dans ton inbox, à trier plus tard ;
- « que dit ma KB sur … ? » → la réponse, avec les passages exacts ;
- « ok fin de session » → résumé, ce qui mérite d’être gardé, la suite.

Tu approuves toujours toi-même : dans le terminal (`okb review`) ou dans
l’application web, qui te demande une confirmation sur ton écran. Chaque
changement s’annule avec `okb undo`.

## 4. Pour aller plus loin

Le [guide d’utilisation](docs/guide/README.md) : la journée type, l’application
web, les réglages (langues, style, plusieurs KB, cohabitation avec d’autres
outils) et le dépannage.

## Pour les développeurs

```bash
npm ci
npm run release:check        # types, tests, plugin, installation propre du paquet
claude plugin validate ./plugin --strict
claude --plugin-dir "$PWD/plugin"   # charger le plugin pour une seule session
```

Documentation technique : [docs/dev](docs/dev/). Les profils, les KB et les
sources personnelles restent hors de ce dépôt ; les tests n’utilisent que des
données fictives.
