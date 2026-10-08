---
type: Meeting
title: 2026-09-14 — Atlas, point export
description: Décision de paginer l'export comptable et répartition des actions avant la clôture de septembre.
status: stable
x_okb:
  template: meeting
  brain: { type: meeting, product: Atlas }
  confidence: reported
---

🧭 [🧠 Travail](../../../../Accueil.md) › [Activité](../../Activité.md) › [Réunions](../Réunions.md)

# 2026-09-14 — Atlas, point export

## ⚡ En bref

L'export comptable coupe les gros mois ; l'équipe passe à un export paginé avant la clôture de septembre. Deux actions, une échéance au 25.

## 🎯 L'essentiel

Le service financier a reçu un fichier de 10 000 lignes pour un mois qui en comptait 14 200. Personne ne l'avait vu : aucun message d'erreur. La cause est une limite fixe dans la requête.

## ✅ Décisions

- L'export lit les factures par pages de 1 000 et écrit au fil de l'eau.
- Le fichier ne change pas de format : le service financier n'a rien à refaire.

## 📋 Actions

| Qui | Quoi | Pour quand |
|---|---|---|
| Développeur Atlas | corriger l'export (ticket ABC-123) | 2026-09-22 |
| Responsable QA | test avec 15 000 commandes | 2026-09-25 |

## 🗂️ Sujets abordés

- Pourquoi la limite existait : une ancienne protection contre les dépassements de mémoire.
- Faut-il prévenir les clients ? Non, l'export est interne.
