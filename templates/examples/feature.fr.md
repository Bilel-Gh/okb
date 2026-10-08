---
type: Guide
title: Atlas — Export comptable
description: Ce que fait l'export comptable d'Atlas, qui s'en sert, comment il marche et ses limites connues.
status: stable
x_okb:
  template: feature
  brain: { type: feature, product: Atlas }
  confidence: verified
---

🧭 [🧠 Travail](../../../Accueil.md) › [Produits](../../Produits.md) › [Atlas](../Atlas.md)

# Atlas — Export comptable

## ⚡ En bref

L'export comptable donne au service financier un fichier CSV des factures d'un mois, prêt à importer dans leur logiciel. À retenir : il ne prend que les factures envoyées, jamais les brouillons.

## 🎯 Ce que ça fait

Un écran « Export » propose un mois et un bouton « Télécharger ». Le fichier contient une ligne par facture : numéro, date, client, montant HT, TVA, TTC [^d1].

## 👥 Qui l'utilise

Le service financier, une fois par mois, pour le rapprochement bancaire. Les commerciaux n'y ont pas accès (rôle `finance` requis).

## 🔁 Comment ça marche

Le front appelle `GET /exports/accounting?month=2026-09` ; l'API lit les factures par pages et écrit le CSV au fil de l'eau (voir [ABC-123 — Export CSV des commandes](../Code/atlas-api/Tickets/2026/ABC-123%20—%20Export%20CSV%20des%20commandes.md)).

## 📏 Règles métier

- Seules les factures au statut `sent` entrent dans l'export [^c1].
- Les montants sont arrondis au centime, ligne par ligne, pas sur le total.
- Une facture annulée sort avec un avoir sur une seconde ligne, montant négatif.

## 🗂️ Où regarder

| Pour | Fichier |
|---|---|
| la requête | `atlas-api/src/exports/accounting.ts` |
| le format des colonnes | `atlas-api/src/exports/columns.ts` |
| l'écran | `atlas-web/src/pages/Export.tsx` |

## 🚧 Limites connues

- Un mois à la fois : un export annuel se fait en douze fichiers.
- Les colonnes sont fixes ; un autre logiciel comptable demanderait un nouveau format.

[^d1]: Spécification « Export comptable v2 », section 3.
[^c1]: `atlas-api/src/exports/accounting.ts:22`
