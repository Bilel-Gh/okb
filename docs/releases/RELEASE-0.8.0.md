# Version 0.8.0

Cette version te laisse **choisir tes KB** : aucune n'est connectée d'office, tu
nommes chacune, tu peux en retirer une, et une ancienne KB se convertit au format
OKB. OKB se partage aussi sans accès à son dépôt.

## Aucune KB par défaut, et tu le vois

- L'installation ne crée plus de KB d'office. `okb init` demande par quoi
  commencer :
  - créer une nouvelle KB ;
  - connecter un dossier de notes existant ;
  - plus tard.

  `install.sh --yes` installe OKB sans KB.
- Tant qu'aucune KB n'est connectée, **« Aucune KB connectée »** s'affiche là où
  apparaît d'habitude le nom de la KB :
  - la barre d'état de Claude Code ;
  - l'application web, qui propose de créer une KB ou de connecter un dossier ;
  - le menu `okb` ;
  - `okb status`.

## Tu nommes tes KB, et rien n'est nominatif par défaut

- Le nom d'une nouvelle KB n'est jamais pré-rempli. Dans le terminal, l'app web
  et Claude (`/okb:onboard`), il t'est toujours demandé.
- OKB ne lit plus aucun nom de personne, ni Git ni compte de l'ordinateur : les
  approbations sont signées `human:me`. Une réponse sur un repo n'a pas de nom,
  seulement un rôle si tu en donnes un.

## Connecter, retirer, convertir

- **`okb kb add <dossier>`**, ou *Connecter un dossier de notes existant* dans
  l'app web : connecte un dossier sous le nom que tu choisis, en KB
  confidentielle si tu veux. Aucune note n'est écrite.
- **`okb kb remove <kb>`**, ou *Retirer d'OKB* : déconnecte une KB. Ses notes
  restent dans leur dossier, et elle se reconnecte avec `okb kb add`.
- **Convertir une ancienne KB** : `/okb:convert` dans Claude Code (ou
  « convertis cette KB au format OKB »). Claude choisit le modèle, le titre et la
  description de chaque note à partir de la note elle-même. OKB prépare alors
  une seule proposition :
  - les en-têtes qui manquent, en gardant les champs existants ;
  - les liens Obsidian `[[…]]` changés en liens Markdown ;
  - chaque note rangée dans le dossier de sa catégorie, avec tous les liens
    réécrits.

  Le texte des notes n'est pas réécrit. Sans Claude : `okb kb convert` écrit un
  plan, puis `okb kb convert --plan-file <plan>`.
- *Vérifier le format* (page Mes KB) dit combien de notes datent d'avant OKB.

## Mettre à jour sans accès au dépôt

- `okb update` explique clairement quand le dépôt GitHub d'OKB n'est pas
  accessible.
- `npm pack` crée un paquet `okb-x.y.z.tgz` à partager.
- La personne qui le reçoit l'installe avec `npm install -g okb-x.y.z.tgz`, puis
  met à jour avec `okb update --from okb-x.y.z.tgz`.
- Le paquet contient maintenant tout ce qu'il faut au plugin Claude.

## Corrections

- `install.sh` sur un ordinateur déjà configuré propose lui-même les
  réparations. Avant, il conseillait `okb doctor --fix` alors que la commande
  `okb` n'existait pas encore.
- Le hook de suggestion d'OKB ignore les notifications de Claude Code (fin d'une
  tâche en arrière-plan). Les statistiques d'utilisation ne coupent plus une
  tâche en deux à cause d'elles.
- Une application web lancée sans KB suit la KB connectée ensuite.

## Vérification

`npm run release:check`. Les nouveaux tests couvrent :
- la conversion d'une KB fictive écrite avant OKB : plan, refus d'un plan
  incomplet, proposition, application, puis `okb maintain` sans champ manquant ;
- la connexion et le retrait d'une KB sans toucher aux notes ;
- les mises à jour par paquet ;
- les intentions « convertis cette KB ».
