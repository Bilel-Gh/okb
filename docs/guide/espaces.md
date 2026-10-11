# Deux espaces : Mon bagage et Travail

Ce que tu apprends t'appartient. Les dossiers d'un employeur ou d'un client, non.
OKB range donc chaque cerveau dans un **espace**, et les deux ne se mélangent
jamais.

| Espace | Ce qu'il contient | Règle |
|---|---|---|
| **Mon bagage** | ce qui te suit toute ta vie : tes compétences, tes méthodes, tes leçons, tes réalisations | rien de confidentiel d'un employeur ou d'un client ; il ne part jamais dans un partage |
| **Travail** | les projets, les notes et les documents d'un employeur ou d'un client | ne se mélange à aucun autre espace |

## Choisir l'espace

En haut à gauche, le nom de ton cerveau ouvre la liste : **Mon bagage** d'abord,
**Travail** ensuite, chacun avec ses cerveaux. Une recherche, le graphe, la
journée : tout ce que tu vois vient du cerveau ouvert, et de lui seul.

Un cerveau « carrière » est rangé dans Mon bagage. Tout autre cerveau est rangé
dans Travail : c'est le côté prudent. Tu changes ça dans **Réglages › Espace de
ce cerveau**, ou dans le terminal :

```bash
okb settings set kb.space baggage
```

## Garder dans mon bagage

Une méthode trouvée au travail servira ailleurs. Pour l'emporter sans rien
emporter du travail :

1. Ouvre la note, puis **··· › Garder dans mon bagage**.
2. OKB te montre la note **sans aucun détail du travail** : les noms de produits,
   de clients et de dépôts, les références de tickets, les adresses, les liens
   internes et les montants ont laissé place à des mots neutres (« un produit »,
   « un ticket »). Il liste ce qu'il a retiré.
3. **Relis et réécris.** C'est une première version, faite sans IA : la phrase
   « Le ticket un ticket a coûté un montant » demande ta main.
4. **Proposer à mon bagage** : la note attend ton oui dans Mon bagage, comme tout
   changement. Change d'espace pour la relire et l'approuver.

Si ta version nomme encore le travail, OKB la refuse et te dit ce qui reste.

Dans le terminal : `okb baggage draft "<note>"` montre la version sans détail ;
`okb baggage keep "<note>" --file <ta version.md>` la propose. Avec Claude :
« garde cette méthode dans mon bagage » ; il la réécrit en leçon générale, tu
relis, OKB vérifie.

## Ce qui ne traverse jamais

- La note qui arrive dans ton bagage ne garde ni le chemin, ni l'identifiant, ni
  les sources de la note de travail. Elle dit seulement qu'elle vient du travail,
  et quand.
- **Partager** ([un pack pour un collègue](modules-et-niveau.md)) est refusé
  depuis Mon bagage, et un pack reçu ne peut pas y entrer.
- Un assistant ne peut pas emporter une note 🔒 : il ne la voit pas.

## À savoir

- Sans cerveau dans Mon bagage, OKB te le dit et te propose d'en créer un
  (un cerveau « carrière »), ou d'y ranger un cerveau qui est à toi.
- Si tu as plusieurs cerveaux dans Mon bagage, « Garder dans mon bagage » remplit
  le premier ; pour en choisir un autre, `baggage.kb` dans la configuration d'OKB.
- La détection est faite sans IA, à partir de ce que ton cerveau connaît (ses
  produits, ses clients, ses dépôts) et de formes reconnaissables (ABC-123, une
  adresse, un montant). Elle ne remplace pas ta relecture.
