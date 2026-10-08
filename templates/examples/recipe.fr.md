---
type: Procedure
title: Retrouver le commit qui a introduit un bug
description: git bisect trouve le commit fautif en quelques essais, même sur des centaines de commits.
status: stable
x_okb:
  template: recipe
  brain: { type: recipe }
---

# Retrouver le commit qui a introduit un bug

## ⚡ En bref

`git bisect` coupe l'historique en deux à chaque essai : sur 500 commits, il trouve le fautif en 9 essais.

## ⌨️ La commande

```bash
git bisect start
git bisect bad                 # le commit actuel a le bug
git bisect good v2.3.0         # cette version n'avait pas le bug
# Git choisit un commit : tester, puis
git bisect good   # ou: git bisect bad
git bisect reset               # revenir où on était
```

## 🎯 Quand

Un comportement marchait dans une version et ne marche plus, sans qu'on sache quel changement l'a cassé.

## 🔍 Ce qu'elle fait

Git propose un commit au milieu de l'intervalle ; chaque réponse `good` ou `bad` élimine une moitié.

## 🔀 Variantes

- Automatique avec un test : `git bisect run npm test -- orders.test.ts`.
