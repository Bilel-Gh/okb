# A repository in a work brain

In a brain (`okb brain where --json` answers, or `okb repo status --json` shows
`brain`), a repository is one level of the zoom:

```
2 Produits/<product>/                 ← the product: what it does, its architecture
2 Produits/<product>/Code/<repo>/     ← the repository pack (this skill)
2 Produits/<product>/Code/<repo>/Tickets/<year>/   ← its tickets (okb-dev-ticket)
```

## Before writing

1. **Its product.** `okb product --json`. Unset → ask with buttons (the products
   found, « Un nouveau produit », « Socle commun » for a shared library), then
   `okb product set <repo> "<product>"`. The pack's paths follow.
2. **One card for the whole pack.** Writing a pack costs tokens: the user
   decides once.
   `okb suggest add --type repo-hub --title "<repo>" --repo <repo> --product "<product>" --scope "<repo folder>" --notes 6 --why "<what they will get>" --signal requested --json`
   Show the card (cost included) with « Créer le pack (recommandé) » ·
   « Seulement Démarrer et l'architecture » · « Plus tard ». With a yes,
   `okb suggest accept <id> --json`; pass `--suggestion <id>` to every
   `okb repo write` of the pack (the scope covers the folder).

## While writing — the elevator

- A fact about this repository → its pack.
- A business rule, a feature or a flow that crosses repositories → the product
  level (`okb product show "<product>" --json` says what exists); note it as a
  separate suggestion for `okb-dev-product`, do not stuff it into the pack.
- A method or a trap true beyond this repository → the toolbox (`method`,
  `known-error`), as its own suggestion.

Each note: `okb template show <template> --example`, the
`okb:okb-quality-reviewer` grade, then `--quality <justness>` on `okb repo write`.

## After

`okb brain context "<repo folder>" --json` shows the parents and siblings the
pack now links to; the product hub gains the repository on approval.
