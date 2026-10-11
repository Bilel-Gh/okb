# Exporter et récupérer son espace

Dans Sauvegardes, « Exporter mon espace » copie une sauvegarde complète dans un
dossier neuf ou vide. Dans l’application desktop, vous pouvez le choisir avec
le sélecteur de dossiers de votre ordinateur.

L’export contient :

- `kb/` : les notes et documents originaux ;
- `state/` : la base SQLite cohérente et l’état privé — projets, actions,
  conversations, apprentissage, tickets et propositions ;
- `profile/profile.yaml` : les réglages de cet espace ;
- `manifest.json` : date, empreintes des fichiers et inventaire.

La clé d’approbation reste sur la machine. Une nouvelle installation crée sa
propre clé ; les anciennes autorisations ne permettent pas d’approuver un
nouveau changement. L’export ne prend pas les autres espaces ni
l’authentification de votre agent IA. Les références vers un dépôt Git partagé
ou un repository de code ne recopient pas ces dépôts.

Cet export est personnel et peut contenir des documents confidentiels. Pour
donner des notes à un collègue, utilisez Partager ou un pack.

Pour vérifier une sauvegarde sans toucher à vos notes, lancez « Essayer une
restauration » dans Sauvegardes. OKB restaure dans un dossier temporaire,
contrôle ce qui revient et affiche le résultat. Une vraie restauration vise
un dossier vide et un nouveau nom d’espace ; elle conserve l’espace d’origine.

Le dossier exporté utilise le format des sauvegardes OKB. Pour le restaurer
avec l’outil existant, gardez une copie de l’export intacte, puis placez son
contenu dans le dossier de sauvegarde de l’espace source, sous la date
`YYYY-MM-DD` indiquée dans le manifeste. Son emplacement est indiqué dans
Sauvegardes ou par `okb backup list --json`. Il apparaît alors dans la liste et
se restaure comme une autre sauvegarde. Sur une nouvelle installation, créez
d’abord un espace vide portant l’identifiant source, puis placez-y cette
sauvegarde et restaurez sous un autre nom. Une importation par sélection de
fichier en un clic reste à ajouter ; l’export ne la prétend pas disponible.
