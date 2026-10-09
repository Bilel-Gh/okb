---
name: OKB
description: A local second brain with two themes to choose from — Atelier, a developer's tool, and Classique, the interface of the first versions — each light or dark, under the linked-note logo in gradient.
version: 1.5
---

# Design System: OKB 1.5

Chosen by the user on 8–9 October 2026 from mockups (spec:
`docs/dev/specs/2026-10-08-identite-1-5.md`). It replaces the « metro map »
direction of the night of 8–9 October, which was rejected.

## Overview

OKB is a tool used all day beside an editor and a terminal. The person picks how
it looks, once, in the **Appearance** menu (top right, or ⌘K):

- **Atelier** (default) — a developer's tool: a dark activity bar, a violet
  status bar at the foot of the window, paths and numbers in monospace, section
  titles written like code comments (`// ce qui attend ton oui`), dense rows.
- **Classique** — the interface of the first versions, made consistent: emerald
  green, slate greys, airy rounded cards, emojis for the note types, the soft
  green glow on the welcome card.
- Each theme is **light (the default), dark or as the system says**.

Both themes share the same structure and components; only the tokens (colours,
fonts, radii, density) and a few touches (comment-style titles, the status bar,
emojis or tags for types) change. Theme code: `web-app/src/styles/tokens.css`,
`web-app/src/app/theme.ts`.

## The logo

The person is still choosing, so **every proposal stays available** in the
Appearance menu (and ⌘K): fourteen marks from two series, each **in gradient**
(the theme's tile with a light from above) **or flat**. The default is **the
linked note**, `o—•` — a note that calls another — in gradient.

- Second series (soft rounded tile): the linked note, the linked note on a dark
  ground, the note and its links, the constellation, the living diamond, the O of
  notes, the prompt `o_`, the prompt typing, the prompt on colour.
- First series (plain rounded tile): the graph, the brackets, the prompt, the
  linked note, the cards.

Colours follow the theme (violet in Atelier, green-to-teal in Classique — the
gradient of the very first logo), not light or dark. The browser tab icon is
redrawn to match. Drawing: `web-app/src/ui/Logo.tsx`; archive with every variant
as SVG: `docs/design/logos/`.

## Colours

One accent per theme. It is the main action, the current place and the focus —
nothing else. Hue otherwise comes only from the note types (the server's category
colours) and the product colours of repositories; data stays in plain colours.

| Token | Atelier light | Atelier dark | Classique light | Classique dark |
|---|---|---|---|---|
| ground | `#f5f5f9` | `#14141c` | `#f6f7f9` | `#0a0e13` |
| surface | `#ffffff` | `#1a1a24` | `#ffffff` | `#10161d` |
| ink | `#1b1b2a` | `#dcdcea` | `#0f172a` | `#e6ebf1` |
| ink-3 (muted) | `#5f5f78` | `#8e8ea8` | `#5f6e84` | `#8a99ab` |
| accent | `#5b4be0` | `#8b7cf6` | `#08845b` | `#34d399` |
| side bar | `#1d1d2b` | `#0f0f15` | `#ffffff` | `#0d1218` |

### Gradients

The identity is drawn in gradient, like the logo, with restraint:

- **the main button** (`--accent-grad`): violet `#6e5ef0 → #4b3ad4` (night
  `#a497ff → #7c6cf6`), green `#08845b → #0b6a7d` (night `#34d399 → #14b8a6`);
- **the status bar** (Atelier), the **current page** in the side bar, the
  **counts**, the **brain avatar**, the **selected note** (`--wash`, the accent
  fading out), the **welcome card** (a soft wash in Atelier, a glow in Classique);
- **levels and progress** fill from a lighter tint to the full colour.

Text on a gradient keeps WCAG AA on its lightest stop (checked for all four
variants). The type bar of Today stays in plain colours: it is data.

## Typography

| | Atelier | Classique |
|---|---|---|
| Interface | IBM Plex Sans, 13.5 px | Inter, 14.5 px |
| Code, paths, numbers | JetBrains Mono | JetBrains Mono (numbers in Inter, tabular) |
| Section titles | mono, lowercase, `//` prefix | sans, sentence case |
| Page title | `~/Page / Détail` in mono | « Page / Détail » |

Fonts are served by OKB itself (latin and latin-ext), never by an outside
service. Every number that changes or is compared uses tabular figures.

## Shapes and density

| | Atelier | Classique |
|---|---|---|
| Radii (small · card · panel · button) | 4 · 6 · 8 · 5 px | 8 · 12 · 14 · 8 px |
| Row height | 44 px | 52 px |
| Shadows | almost none | soft, ambient |

Spacing is a 4 px grid (4, 8, 12, 16, 20, 24, 32, 40, 56).

## The shell

- **Side bar, folding.** Folded: 56 px, icons only, each named on hover, the
  current page marked on its edge. Unfolded: 232 px, icons and words. A button at
  the top of the bar, beside the logo, and **⌘\ / Ctrl+\\** fold or unfold it;
  the choice is kept.
  Without a choice: folded in Atelier, unfolded in Classique.
- **Top bar**: the page title (with the page it belongs to), the search (⌘K), the
  Appearance menu (theme, light or dark, logo and its style).
- **Status bar** (Atelier): the brain, its notes, what waits, its health, the
  language — each a link.
- **On a phone**: the side bar slides in from a menu button; five tabs at the
  bottom (Today, Brain, To review, Repos, Learn).

## Components

- **Buttons**: one main (gradient) per context; default (surface, hairline);
  ghost; danger (red text, never filled). 34 px, 28 px small.
- **Note type mark**: an emoji in a tinted square (Classique) or the type's name as
  a mono tag (Atelier), in the type's colour (`ui/CatMark.tsx`).
- **Breadcrumb**: a path with chevrons, mono in Atelier (`ui/Breadcrumb.tsx`).
- **Level bar**: a bar filled to the level in the product's colour, a mark where
  each tier starts (20, 45, 70, 90), the tier names below (`ui/LevelBar.tsx`).
- **Chips**: links and filters; pressed chips tint with their colour.
- **Panels**: surface, hairline, the theme's radius; Atelier titles as comments.
- **Menus and palette**: surface, floating shadow; the selected item tinted with
  the accent.
- **System map** (Repos › Architecture): repositories as ringed stations in their
  product colour, calls as straight and 45° lines, events dashed, libraries
  dotted; the selected station takes the accent.

## Do's and don'ts

- **Do** keep one accent per theme and one main (gradient) button per context.
- **Do** use the tokens (`var(--accent)`, `var(--accent-grad)`, `var(--wash)`…),
  never a raw colour in a component.
- **Do** check both themes in light and dark, on a desktop and a phone.
- **Do** gate movement behind `prefers-reduced-motion: no-preference`.
- **Don't** put a gradient on data (type bars, charts) or under long text.
- **Don't** add coloured side or top bars to cards, or animate widths: bars show
  their value at once.
- **Don't** load a font or a script from an outside service.
- **Don't** bring back the metro vocabulary (navy rail, signal yellow, stations on
  lines everywhere).
