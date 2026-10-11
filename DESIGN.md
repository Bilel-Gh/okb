---
name: OKB
description: A local second brain with two themes to choose from — Atelier and Classique — each light or dark, drawn in gradient or flat, in one font (Inter), under the linked-note logo.
version: 2.0
---

# Design System: OKB 2.0

Chosen by the user on 8–9 October 2026 from mockups (the last one,
`interface-1-5.html`, validated with « Inter, dégradé, les deux thèmes, clair par
défaut »). It replaces the « metro map » direction, which was rejected, and the
first 1.5 draft, whose two fonts, `//` titles and mixed flat/gradient looked
untidy.

## Four principles

1. **One font everywhere: Inter.** Titles, menus, numbers, repository names, paths,
   differences to review. Monospace (JetBrains Mono) only for code itself: code
   blocks, inline code, commands to copy.
2. **Gradient or flat, the same everywhere.** One setting (`data-style`) draws the
   logo, the main button, the current page, the avatar, the badges, the fills, the
   welcome card and the status bar in the theme's gradient — or all in plain colour.
   Gradient by default.
3. **Both themes share one structure.** Same components, sizes, radii and spacing;
   only the colours change. **Atelier** (default): violet, a dark side bar, a status
   bar at the foot. **Classique**: green, a light side bar, the interface of the
   first versions. Each light (default), dark or as the system says.
4. **No code dressing.** No `//` or `~/` prefixes, no type names as code tags:
   section titles are real titles; each note type has its **icon in a square tinted
   with its colour**, the same everywhere.

Theme code: `web-app/src/styles/tokens.css`, `web-app/src/app/theme.ts`.

## The five screens

The 2.0 keeps the 1.5's look (Atelier and Classique, unchanged) and groups its
thirteen destinations into five screens (`web-app/src/app/nav.ts`). Old addresses
(`#/notes`, `#/graph`, `#/repos`, `#/weekly`, `#/health`…) open the right page in
the right screen (`web-app/src/app/router.ts`).

| Screen | Holds |
|---|---|
| Aujourd’hui | the day · Focus et journal (focus note, end a session, journal) · Revue de la semaine |
| Projets | the projects (where each stands, its next step) · with the developer module: Repos (level of knowledge, a repository's page) · Architecture |
| Mémoire | Notes: the explorer (folders or types as a foldable tree, the grouped list, the note or the folder's page) · Graphe: every note by theme, type or folder, the brain seen from above, the notes to tidy |
| Assistant | Demander: the passages that answer, then an answer that cites them · Dans ton terminal: OKB in Claude Code |
| Progresser | Réviser · Progression (level, badges) · Carrière |

| Elsewhere | Holds |
|---|---|
| À valider (top bar) | Notes à écrire · Changements prêts · Captures · Historique |
| Plus (menu) | Outils (add a source, skills, templates and style, categories, share) · Santé (health, backups, usage, diagnosis) · Modules · Aide |
| Réglages | general · appearance · my brains · create a brain |

Words on screen stay simple: no « KB », « proposition » or « bundle »
(`tests/web-app/words.test.ts`).

## The logo

**Every proposal stays available** in Appearance (and ⌘K): fourteen marks from two
series. The default is **the linked note** `o—•`. It follows the site's style
(gradient or flat) and the theme's colours (violet or green-to-teal). Drawing:
`web-app/src/ui/Logo.tsx`; archive: `docs/design/logos/`.

## Colours

One accent per theme: the main action, the current place, the focus. Hue
otherwise comes only from the note types (the server's category colours), the
drawers and the products; data stays in plain colours.

| Token | Atelier light | Atelier dark | Classique light | Classique dark |
|---|---|---|---|---|
| ground | `#f6f6f9` | `#111117` | `#f6f7f9` | `#0b0f14` |
| surface | `#ffffff` | `#17171f` | `#ffffff` | `#11161d` |
| ink | `#17171f` | `#ececf3` | `#101828` | `#e8edf3` |
| ink-3 (muted) | `#6a6a80` | `#9090a6` | `#667085` | `#8b99aa` |
| accent | `#5b4be0` | `#8b7cf6` | `#0a8a5e` | `#34d399` |
| side bar | `#18181f` | `#0d0d12` | `#ffffff` | `#0d1218` |

- `--fill` is the gradient (or the flat colour): `#6e5ef0 → #5b4be0 → #4535c6` in
  Atelier, `#098257 → #0b6f86` in Classique light, `#6ee7b7 → #14b8a6` in Classique
  dark. Words on it keep WCAG AA on its lightest stop.
- `--fill-bar` (bars and progress) is brighter; `--hero` and `--hero-glow` make the
  soft welcome cards.

## Type and shape

- Inter, 14 px body, `cv11` and `ss03`; tabular figures for every number that
  changes. Page titles 16 px in the top bar, 28–32 px for a note or a welcome.
- A note reads at 15.5 px / 1.72, 68 characters wide; callouts are tinted by kind,
  code blocks dark, tables bordered.
- Radii 8 · 10 · 14 px; buttons 34 px (30 small, 40 large); rows 48 px.
- Spacing on a 4 px grid.

## The shell

- **Side bar**: 240 px with words or 64 px with icons (each named on hover); the
  button at the top beside the logo, or ⌘\. The current page is filled with
  `--fill`. Folded in Atelier, unfolded in Classique until the person chooses.
- **Side bar content**: the five screens, then at the foot the « Plus » menu (a
  popover with one line of help per entry) and Réglages.
- **Top bar**: the page (with the page it belongs to, as a link), the search (⌘K),
  « Garde ça » (⌘J, a popover with one field: what the person writes is kept at
  once), « À valider » with its count, the Appearance menu.
- **Screen tabs**: a slim bar under the top bar when the screen has several pages
  (Mémoire, Assistant, Projets with the developer module).
- **Status bar** (Atelier): the brain, its notes, what waits, its health.
- **On a phone**: the side bar slides in; the five screens as tabs at the bottom.

## Components

`reader/Provenance.tsx` is the « Sources et validité » zone under a note (a native
`details`: sources, author, approval, validity, and the on-request freshness check).
`pages/Projects.tsx` holds `KindMark` (a project's kind in a tinted square) and the
project page; `pages/day-parts.tsx` holds `ActionList` (actions to tick, with a
field that reads the line) and `JournalList` (lines by day, each kind with its
icon in a tinted square).

`ui/`: `CatMark`/`TypeMark` (type icon in a tinted square), `PageTabs` (a
destination's pages, each with its address), `Breadcrumb`, `LevelBar`, `Ring` (a
score out of 100), `DiffView` (a diff to read), `Choice` and `Switch`,
`ConfirmDialog`, `States` (empty, error, loading). The explorer's filters, table,
cards and selection bar are in `pages/brain-views.tsx`; the concept bubble in
`reader/Bubble.tsx` (waits for the pointer to rest, fades, an arrow on the word). Panels, pills,
chips, tabs and buttons are in `styles/components.css`; the explorer and the
reader in `styles/brain.css`; the graph in `styles/graph.css` (canvas engine:
`graph/GraphView.ts`: themes as flat tinted discs with a crisp edge, hubs ringed
in their colour; no blur, no glow, no frosted glass on the graph).

## Do's and don'ts

- **Do** use the tokens (`var(--fill)`, `var(--accent)`, `var(--c)`…), never a raw
  colour in a component.
- **Do** check both themes, light and dark, gradient and flat, desktop and phone.
- **Do** gate movement behind `prefers-reduced-motion`.
- **Don't** set text in monospace unless it is code to read or copy.
- **Don't** put a gradient under data (type bars, charts) or long text.
- **Don't** load a font or a script from an outside service.
