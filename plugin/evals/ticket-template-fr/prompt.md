---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
tags: [quality, template, v1, needs-bash]
---
Rédige la note de ce ticket terminé avec le modèle « ticket » d'OKB : lis d'abord le modèle et son exemple (`okb template show ticket` puis `okb template show ticket --example`), puis écris le brouillon dans le fichier `brouillon-ticket.md` de ce dossier. N'écris dans aucune KB et ne prépare aucune proposition.

Contexte du ticket (fictif) :
- Ticket ATL-412 : « L'export CSV des factures plante quand il y a plus de 10 000 lignes. »
- Cause trouvée : `src/export/csv.ts` chargeait toutes les lignes en mémoire avant d'écrire (`rows = await repo.findAll()`).
- Correction : lecture par lots de 5 000 avec un curseur (`repo.stream({ batch: 5000 })`) et écriture au fil de l'eau.
- Test ajouté : `tests/export.test.ts` exporte 25 000 lignes fictives et vérifie la mémoire sous 200 Mo.
- Méthode : reproduire avec un gros jeu de données, mesurer la mémoire, chercher l'appel qui charge tout, remplacer par un flux.
