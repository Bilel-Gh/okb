# Passer de la 1.5 à la 2.0

La 2.0 ouvre tes cerveaux de la 1.5 tels quels. **Tes notes ne sont jamais
touchées** : la 2.0 n'ajoute que de l'état (une base, un dossier de documents).
Une seule chose déménage : tes révisions, de deux fichiers vers la base.

Tu peux regarder ce déménagement avant de le faire, et revenir en arrière.

## 1. Regarder, sans rien changer

```bash
okb migrate 2.0
```

C'est un essai à blanc. Il te dit, pour le cerveau ouvert :

- qu'une sauvegarde complète sera prise avant toute chose ;
- combien de cartes étudiées et de réponses iront dans la base ;
- dans quel espace le cerveau sera rangé (Travail, ou Mon bagage pour un cerveau
  « carrière ») ; voir [les espaces](espaces.md) pour changer ;
- s'il a ses tiroirs (sinon `okb brain migrate`, quand tu veux) ;
- combien de notes il a, et qu'elles ne sont pas touchées.

Pour un autre cerveau : `okb migrate 2.0 --kb <nom>`.

## 2. Le faire

```bash
okb migrate 2.0 --apply
```

Dans l'ordre : la sauvegarde, le déménagement des révisions, la vérification
(toutes sont arrivées), puis la marque « fait ». Si quelque chose coupe en
route, relance la même commande : elle reprend, sans rien faire deux fois.

Ensuite, vérifie que tout revient :

```bash
okb backup drill
```

## 3. Revenir en arrière

```bash
okb migrate 2.0 --rollback
```

Les fichiers de la 1.5 retrouvent tes révisions, avec ce que tu as étudié
depuis. Tes notes n'ont pas bougé. Réinstalle la 1.5 si tu veux y revenir.

À savoir si tu reviens à la 1.5 :

- les projets, les actions et le journal de la 2.0 restent dans leur base ; la
  1.5 ne les lit pas ;
- le dossier `_Documents/` reste dans tes notes ; la 1.5 ne le connaît pas et
  peut signaler ses fichiers.

## Si tu ne lances rien

La 2.0 marche quand même : elle lit tes révisions depuis les fichiers la
première fois, et laisse les fichiers tels quels. `okb migrate 2.0` sert à voir
ce qui se passe, à prendre la sauvegarde d'abord, et à pouvoir revenir.
