---
type: Experience
title: Erreur — jeton expiré pendant un traitement long
description: Un batch de plus d'une heure échoue avec TokenExpiredError ; le jeton doit être rafraîchi avant chaque lot.
status: stable
x_okb:
  template: known-error
  brain: { type: known-error, product: Atlas }
  aliases: [TokenExpiredError, jwt expired]
---

# Erreur — jeton expiré pendant un traitement long

## ⚡ En bref

Un traitement de plus d'une heure perd son jeton d'accès en cours de route. La solution : demander un nouveau jeton avant chaque lot, pas une seule fois au démarrage.

## 🚨 Le symptôme

Dans les logs du batch de nuit (`atlas-batch`), après environ 60 minutes :

```
TokenExpiredError: jwt expired
    at verify (node_modules/jsonwebtoken/verify.js:152)
```

## 🔍 La cause

Le batch obtient un jeton au démarrage (`atlas-batch/src/run.ts:12`) ; ce jeton vit 60 minutes (`expiresIn: 3600`, `auth-config.yaml:4`). Les lots traités après une heure l'envoient expiré [^c1].

## 🛠️ La solution

1. Appeler `getToken()` au début de chaque lot (`atlas-batch/src/run.ts:30`), qui réutilise le jeton s'il lui reste plus de 5 minutes.
2. Relancer le batch : `npm run batch -- --from-lot 37` reprend au lot qui a échoué.

## ✅ Vérifier que c'est réglé

Le log du lot montre `token refreshed` avant le lot 37, et le batch se termine avec `done: 52/52`.

## 🗓️ Vu dans

- [ABC-176](../Code/atlas-batch/Tickets/2026/ABC-176%20%E2%80%94%20Batch%20de%20nuit%20interrompu.md) (septembre 2026)

[^c1]: `atlas-batch/src/run.ts:12` et `auth-config.yaml:4`.
