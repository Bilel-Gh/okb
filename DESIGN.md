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
| Mémoire | Notes: the explorer (folders or types as a foldable tree, the grouped list, the note or the folder's page) · Graphe: every note by theme, type or folder, the brain seen from above, the notes to tidy · Documents: the files kept as they are (a search field, rows with the file's icon, its project, size and date, the passage found; a padlock and « open » on each row) |
| Assistant | Demander: the passages that answer, then an answer that cites them · Dans ton terminal: OKB in Claude Code |
| Progresser | Réviser · Progression (level, badges) · Carrière |

| Elsewhere | Holds |
|---|---|
| À valider (top bar) | Tout: everything that waits, ticked, with one « Oui à ces N choses » button in a foot that stays in view (the evening screen) · Notes à écrire · Changements prêts · Captures · Historique |
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

The 2.1–3.0 additions use these same tokens and five destinations. Sharing lives
under Projects/More; shared results say who wrote them. Understanding lives
beside the source in the reader and under Progress. Assistant has a main page
and a Radix dialog opened from the top bar, with keyboard focus returned on
close. The original source, exact quotations, general explanations and unknown
answers have distinct labels. Suggested effects require a named button.

Developer tickets show independent work, review, CI, waiting and delivery
states; colour never supplies the only status label. First launch asks for an
activity profile, a space and a first project, then offers continuing without
AI. The native wrapper adds folder choice, zoom and explicit update controls.
Its icon reuses the existing linked-note Atelier SVG. Previous design proposals
remain in their archive. No new theme or logo selection is imposed.

Component tests cover these actions and focus semantics. Visual checks at
multiple widths, contrast measurement and a real screen-reader pass remain
release checks; passing a component test does not certify WCAG 2.2 AA.

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

### The ticket sheet (D70)

`pages/ticket/` holds the ticket sheet: `TicketPage` (header, journey, columns,
« More details »), `panels` (In 30 seconds, To do, Linked notes, Details,
pending requests, History) and `parts` (`Editable` text edited where it is
read, `Slot` for an undefined field with « + Add » and ✦ ask the agent, `Prov`
origin as a dot plus its word, `ImportanceBars` one to three bars, `TkRing`
completeness). `pages/today-work.tsx` holds Today's pick-up cards, compact
lines and filters, the todo board and the agent requests. Styles are in
`styles/ticket.css`, Atelier tokens only. Scale: text 12 / 13 / 14 / 15 / 22,
icons 14 / 16 / 18. Labels are small capitals in ink-3; the important line
(objective, next step) is bold; meaning in colour always comes with a word.
Actions shown on hover are also shown on keyboard focus.

### The system map and the team responsible (D72, D73)

`pages/Arch.tsx` keeps the metro map and adds: two filters (supposed links,
outside resources), the certainty pill (proved ok, declared info, supposed
warn, confirmed accent — always with its word), the reason in a sunk box, the
person's gestures (Confirm, Correct the target, Exclude) as small inline forms,
a warn-soft box for an agent's conflict, and below the map « Not on the map »:
one collapsible group per role with its count, classification buttons for an
unknown address, excluded links with « Put back ». A repository's page shows
`RepoTeam` (the team as a pill with its origin, or a dashed slot « Team · Fill
in » and ✦ ask the agent; a conflict in warn-soft; the CODEOWNERS suggestion
in a dashed box) and `RepoRelations` (one line per relation, then « Tools and
links »). Styles are in `styles/arch.css`, Atelier tokens only.

## Do's and don'ts

The October usage fixes keep the same five destinations and Atelier tokens.
Ordinary Projects holds work; repository context stays in Repos. Today,
Projects and Repos reuse `WorkPreview`: title/reference, a named state and a
short next action or blocker link to the specialized ticket. Full text stays
in its detail and the old project address still resolves. Repo documentation,
associated work and source freshness come before technical details.

Work pages offer three contextual Assistant starts (resume, decision reason,
previous error); choosing one prepares the local context and question without
starting a paid call. The answer keeps located passages and access to the
source; errors retain local search. Conversation context follows later turns.

Architecture starts with a bounded useful set. Hidden counts, explicit expansion,
group members and a relation list preserve access to the complete model. Names
wrap at a readable size; the canvas scrolls rather than shrinking all labels.
Uncertain calls, their method/scope and evidence remain distinct from confirmed
declarations. Browser checks on dense fictional data complement layout tests;
they do not establish fidelity to any personal repository or WCAG certification.

- **Do** use the tokens (`var(--fill)`, `var(--accent)`, `var(--c)`…), never a raw
  colour in a component.
- **Do** check both themes, light and dark, gradient and flat, desktop and phone.
- **Do** gate movement behind `prefers-reduced-motion`.
- **Don't** set text in monospace unless it is code to read or copy.
- **Don't** put a gradient under data (type bars, charts) or long text.
- **Don't** load a font or a script from an outside service.
