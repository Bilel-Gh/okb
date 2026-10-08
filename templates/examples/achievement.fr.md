---
type: Experience
title: Réalisations 2026
description: Mes réussites de l'année, au format STAR, avec leurs preuves.
status: stable
x_okb:
  template: achievement
  brain: { type: achievements }
---

# Réalisations 2026

## ⚡ En bref

Six réussites cette année, dont deux qui ont supprimé des erreurs côté clients et une présentation devant l'équipe produit.

## 🏆 Réalisations

### 2026-10-06 — Les exports de commandes ne perdent plus de lignes

- **Situation** : les exports mensuels de plus de 10 000 commandes étaient coupés sans message ; la comptabilité rapprochait des fichiers incomplets.
- **Tâche** : trouver la cause et rendre l'export fiable quelle que soit sa taille.
- **Action** : j'ai reproduit le bug sur 15 000 commandes, trouvé une limite cachée, réécrit l'export en lecture paginée et ajouté un test qui compte les lignes.
- **Résultat** : exports complets (14 200 lignes en septembre au lieu de 10 000), mémoire utilisée divisée par 8.
- **Compétences** : débogage, Node.js, tests automatisés.
- **Preuves** : [ABC-123](../../../2%20Produits/Atlas/Code/atlas-api/Tickets/2026/ABC-123%20%E2%80%94%20Export%20CSV%20des%20commandes.md).
