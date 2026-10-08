---
type: Procedure
title: Déboguer un export incomplet
description: Retrouver pourquoi un export perd des lignes, en comparant ce qui sort à ce qui existe.
status: stable
x_okb:
  template: method
  brain: { type: method }
---

# Déboguer un export incomplet

## ⚡ En bref

Quand un export « marche » mais perd des lignes, compte ce qui existe, compte ce qui sort, puis cherche la limite cachée entre les deux. Dans neuf cas sur dix, c'est une limite codée en dur ou une pagination qui s'arrête trop tôt.

## 🎯 Quand l'utiliser

Un export (CSV, PDF, API) renvoie moins de données que prévu, sans erreur.

## 🪜 Les étapes

1. **Compter la source** : `SELECT COUNT(*)` sur la même période et les mêmes filtres.
2. **Compter la sortie** : `wc -l export.csv` (moins l'en-tête).
3. **Chercher les limites** : `grep -rn "limit\|take\|top\|maxRows" src/export`.
4. **Vérifier la pagination** : la boucle s'arrête-t-elle sur une page vide, ou sur une page incomplète ?
5. **Reproduire en grand** : un jeu de données au-dessus de la limite suspectée.
6. **Écrire le test** qui compte les lignes avant de corriger.

## 💡 Exemple

[ABC-123](../../2%20Produits/Atlas/Code/atlas-api/Tickets/2026/ABC-123%20%E2%80%94%20Export%20CSV%20des%20commandes.md) : une limite de 10 000 lignes cachée dans la requête.

## 🚧 Pièges

- Une pagination qui s'arrête dès qu'une page fait moins que la taille demandée perd la dernière page quand des lignes sont filtrées après coup.
- Comparer des périodes différentes (fuseau horaire !) fausse le comptage.

## 🗓️ Utilisée dans

- ABC-123 (Atlas, octobre 2026)
