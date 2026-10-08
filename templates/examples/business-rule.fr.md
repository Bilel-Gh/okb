---
type: Reference
title: Une facture émise ne se modifie jamais
description: Toute correction d'une facture émise passe par un avoir, puis une nouvelle facture.
status: stable
x_okb:
  template: business-rule
  brain: { type: business-rule, theme: Facturation }
  confidence: verified
---

# Une facture émise ne se modifie jamais

## ⚡ En bref

Une fois émise, une facture est figée. Pour la corriger, on émet un **avoir** qui l'annule, puis une nouvelle facture juste.

## 📏 La règle

Une facture au statut `issued` ne peut plus changer de montant, de client ni de lignes ; seule une facture `draft` se modifie [^c1]. ✅ Vérifiée dans le code.

## 🎯 Pourquoi elle existe

La loi impose que les factures émises restent intactes et numérotées sans trou [^d1].

## 💡 Exemple chiffré

Facture F-2026-0412 émise à 1 200 € HT au lieu de 1 000 € :
1. avoir A-2026-0031 de −1 200 € HT ;
2. nouvelle facture F-2026-0419 de 1 000 € HT.
Le client voit trois documents ; le solde est bien de 1 000 €.

## 🗂️ Où elle vit

- Atlas : `atlas-api/src/invoices/update.ts:27` refuse la modification (`409 InvoiceIssued`).
- Boréal n'émet pas de factures : non concerné.

## 🚧 Exceptions et pièges

- Une faute de frappe dans l'adresse se corrige aussi par avoir + nouvelle facture.
- Ne pas confondre avec une facture `draft`, modifiable librement.

[^c1]: `atlas-api/src/invoices/update.ts:21-34`.
[^d1]: Réunion Facturation du 2026-09-18, compte rendu.
