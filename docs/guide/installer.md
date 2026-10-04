# Installer OKB

Il te faut **Node.js 22.12 ou plus récent** (`node --version`), et de préférence
[Claude Code](https://code.claude.com) et [Obsidian](https://obsidian.md).

## En une commande

Depuis le dossier d’OKB :

```bash
./scripts/install.sh
```

Le script vérifie Node, installe et compile OKB **dans ce dossier seulement**,
puis lance l’assistant `okb init`. L’assistant pose une question à la fois, avec
une réponse recommandée (★) que tu valides avec Entrée :

1. le nom de ta première KB (un sujet ou un projet) ;
2. son dossier — à côté de tes autres KB, ou un coffre neuf ;
3. la langue d’OKB et la langue de rédaction des notes ;
4. le style d’écriture et ton niveau ;
5. les options : historique Git, dépôt GitHub privé (désactivé par défaut) ;
6. le plugin Claude Code et une commande `okb` utilisable partout.

Rien n’est installé hors du dossier d’OKB sans ton « oui ». Tes réglages Claude et
tes fichiers de shell ne sont jamais modifiés.

Pour accepter toutes les recommandations sans question : `./scripts/install.sh --yes`.

## À la main

```bash
npm ci
npm run build
node dist/cli/index.js init
```

## Ensuite

```bash
okb            # le menu : ce qui t’attend, et les actions utiles
okb tour       # une visite guidée de 2 minutes, sur une KB jetable
okb serve      # l’application web
okb doctor     # tout vérifier ; okb doctor --fix répare ce qui peut l’être
```

Dans Claude, tape `/okb` ou demande simplement « aide-moi avec OKB ».

## Mettre à jour

```bash
okb update
```

Récupère la dernière version (si OKB vient d’un dépôt Git), réinstalle, recompile
et met à jour le plugin Claude. Tes profils, ta KB et ton historique sont conservés.

## Ajouter le plugin Claude plus tard

Si tu as répondu non pendant l’installation :

```bash
okb doctor --fix
```

ou, à la main, depuis le dossier d’OKB :

```bash
claude plugin marketplace add "$PWD"
claude plugin install okb@okb
```

Ouvre ensuite une nouvelle session Claude.

## Désinstaller

```bash
claude plugin uninstall okb@okb
```

puis supprime le dossier d’OKB et, si tu l’avais créée, la commande `okb`
indiquée par `okb doctor`. Tes notes ne sont pas touchées ; tes réglages et ton
historique restent dans `~/.okb` (supprime-le seulement si tu ne veux plus pouvoir
annuler d’anciens changements).
