# OKB en arrière-plan — 4 novembre 2026

Checkout de développement non publié ; le numéro du paquet reste 2.4.0.

> **« Quand je travaille sur un ticket, je ne veux pas sentir qu’OKB est là. »**

- **Discret par défaut** (D76) : pendant le travail, Claude ne te propose plus
  de commande, de carte, de vérification ni d’onboarding, et ne te pose aucune
  question sur OKB. Ce qu’OKB repère est gardé sans un mot ; les cartes
  attendent dans l’app (**À valider**).
- **Une ligne qui dit où tu en es** : la première réponse de Claude commence par
  `🎫 ABC-123 Titre · 📦 repo · PR en revue · bloqué · ➡️ prochaine étape`.
  Elle ne montre que ce qui est connu, et revient seulement quand elle change.
- **Un contexte plafonné** : le brief d’un repo tient en 1 000 tokens environ,
  et les notes liées aux fichiers lus arrivent pour cinq fichiers au plus par
  session.
- **Comme en 2.4, si tu préfères** : `okb settings set presence=assist`.

Rien ne change pour ton oui : une note demandée suit les règles de ta KB, et une
note validée ne change jamais sans toi.

Guides : [rien sans ton oui](../guide/demander-avant-ecrire.md) ·
[réglages](../guide/reglages.md).
