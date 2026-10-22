# Valider les notes en un geste

Quand tu demandes une note à Claude en plein travail, tu ne veux pas être
bloqué par une carte, une fenêtre système ou une commande à taper. Avec le
réglage « L’agent range directement, je relis après », la note entre tout de
suite dans ta KB, marquée **à relire**, et tu la tries plus tard, au calme
(F2.0-52 à F2.0-57, D71).

## Choisir le réglage

Dans l’app : **Réglages › Écriture par l’agent**. Deux choix :

- **Rien n’entre sans mon oui** (par défaut, conseillé pour une KB partagée) :
  comme avant, chaque note attend ton approbation ;
- **L’agent range directement, je relis après** : les nouvelles notes sont
  rangées et utilisables tout de suite.

Dans le terminal : `okb settings set changes.agentWrites review-later`. Toi
seul peux changer ce réglage : un agent qui essaie est refusé.

Deux options vont avec : `review.offer` (Claude propose une relecture à la fin
d’une note, activé par défaut) et `review.auto` (`never` par défaut).

## Pendant le travail

Tu dis « garde ça » ou « fais une note sur … ». Ta demande vaut accord : pas de
carte. Claude écrit la note, la range avec `okb keep`, puis te dit en une ligne :
« Note rangée, déjà utilisable : <titre> · <place> · Ouvrir dans OKB ». Une note
que Claude te propose de lui-même garde sa carte de suggestion.

Si la note existe déjà et que tu l’as validée, Claude ne la change pas : sa
modification attend ton oui dans « À relire ».

## Trier au calme

Ouvre OKB avec `okb serve`, puis **À valider › À relire**. La liste est
groupée par jour. Pour chaque note :

- **Oui, je la garde** (touche O) : elle passe en **Validée** (pastille verte) ;
- **Non, la retirer** (touche N) : seule cette note est retirée ; l’historique
  et la copie restent ;
- **Changer l’emplacement** : choisis un dossier dans l’arbre ; les liens vers
  la note suivent ;
- **Faire relire** : Claude confrontera la note à ses sources à ta prochaine
  session.

Une modification d’une note validée montre la différence avant/après :
**Oui, appliquer** ou **Non, garder ma version**. **Oui à tout, sauf…** valide
ce qui reste ; traite d’abord une par une les notes à garder de côté.

Aucune fenêtre système ni commande : `okb serve` ouvre ton navigateur avec un
lien à usage unique qui le reconnaît. Dans un autre navigateur, ou avec
`--no-open`, l’app te demande la confirmation habituelle.

## Le pourcentage de notes validées

Il dit quelle part de ta KB tu as relue : une ligne discrète sous la date de
l’accueil (« 3 notes à relire · mémoire validée à 82 % »), la barre d’état et
les Indicateurs. Les notes existantes sont validées si tu les as approuvées ou
écrites toi-même, à relire si elles ont été générées sans trace d’approbation.
Une KB vide affiche « — ».
