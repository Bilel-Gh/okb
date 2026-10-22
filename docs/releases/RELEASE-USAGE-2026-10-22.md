# Valider en un geste — 22 octobre 2026

Checkout de développement non publié ; le numéro du paquet reste 2.0.0.

- **F2.0-52, D71** : un réglage par KB, que seule la personne change :
  « Rien n’entre sans mon oui » (par défaut) ou « L’agent range directement, je
  relis après ». Options de relecture `review.offer` et `review.auto`.
- **F2.0-53** : chaque note est « à relire » ou « validée » ; l’état vit dans
  l’état local, aucune note n’est réécrite. Les notes existantes approuvées ou
  écrites par la personne sont validées, les notes générées sans trace sont à
  relire.
- **F2.0-54** : `okb keep` range tout de suite une nouvelle note ou la
  modification d’une note à relire ; la modification d’une note validée attend.
- **F2.0-55** : l’écran « À relire » : Oui, Non, Changer l’emplacement (liens
  réparés), Faire relire, Oui à tout ; clavier O, N, flèches ; « Tout est trié ».
- **F2.0-56** : `okb serve` reconnaît le navigateur qu’il ouvre : approuver et
  trier se font sans fenêtre système ni terminal.
- **F2.0-57** : la part de notes validées, discrète sur l’accueil, dans la barre
  d’état et en cinquième indicateur.
- Côté agent : une note demandée vaut accord ; Claude annonce la note rangée en
  une ligne et propose une relecture ; le brief de session donne le nombre de
  notes à relire et les relectures demandées.

Limites : la clé du navigateur passe en argument de la commande qui l’ouvre et
ne protège pas d’un logiciel qui pilote la souris ; « Oui à tout » n’a pas de
liste d’exceptions ; les pastilles d’état ne sont que dans « À relire » et le
lecteur.
