---
name: OKB
description: A local second brain drawn as a transit map; subjects are lines, notes are stations.
colors:
  signal-yellow: "#ffcd00"
  signal-yellow-hover: "#f2c200"
  signal-yellow-night: "#ffd21f"
  on-signal: "#101a2e"
  rail-navy: "#13223f"
  rail-navy-raised: "#1c2f54"
  rail-navy-night: "#142a52"
  rail-ink: "#eef2fa"
  rail-ink-muted: "#a9b6cf"
  rail-hairline: "#2a3d63"
  ground: "#f2f4f8"
  surface: "#ffffff"
  sunk: "#e9edf3"
  hover: "#eef1f6"
  ink: "#101a2e"
  ink-secondary: "#39445c"
  ink-tertiary: "#5c677f"
  hairline: "#dde2ea"
  hairline-strong: "#c3cad7"
  ground-night: "#0b1322"
  surface-night: "#111b2e"
  ink-night: "#e8edf6"
  focus-blue: "#2457d6"
  ok: "#1d7f47"
  warn: "#9a5b00"
  err: "#b8233a"
  drawer-inbox: "#64748b"
  drawer-world: "#0891b2"
  drawer-subjects: "#2563eb"
  drawer-toolbox: "#059669"
  drawer-activity: "#7c3aed"
typography:
  display:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
  title-sm:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  body-read:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.55
  code:
    fontFamily: "Fira Code, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "0.9em"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "40px"
  s14: "56px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.on-signal}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.signal-yellow-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "36px"
  button-sm:
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "38px"
  rail-link:
    backgroundColor: "transparent"
    textColor: "{colors.rail-ink-muted}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "38px"
  rail-link-current:
    backgroundColor: "{colors.rail-navy-raised}"
    textColor: "{colors.rail-ink}"
  rail-count:
    backgroundColor: "{colors.rail-ink}"
    textColor: "{colors.rail-navy}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
  line-badge:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 10px 0 6px"
    height: "24px"
  pill:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px 20px 20px"
  roundel:
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    size: "26px"
---

# Design System: OKB

## Overview

**Creative North Star: "The Metro Map"**

A brain is a transit network. Subjects and products are lines, notes are stations, and wherever you are, the interface draws the line you are on and marks the station you stand at. The shell is a deep navy rail, like the signage band on a platform wall; the working ground is a cool off-white with white surfaces on it. Colour is almost entirely given over to lines: each drawer, note category and product owns one line colour, and those colours appear only as strokes, station rings, roundels and tinted badges.

One colour is held back from the network. Signal yellow marks the primary action and the "you are here" station, nothing else, so the eye can always find the next thing to do and the current position. Everything that is not a line, a station or the signal stays quiet: navy ink on cool grey, hairline borders, soft ambient shadows.

The density is that of a daily tool used beside an editor all day: compact rows, tabular numerals, a fixed type scale, keyboard-first. It refuses the near-black developer dashboard of equal metric tiles lit by one neon accent.

**Key Characteristics:**
- Navy rail shell in both themes; cool off-white (light) or deep blue-black (dark) ground; never cream.
- Lines carry colour: 3 px strokes, ringed station dots, numbered roundels, pill badges tinted with the line colour.
- Signal yellow reserved for the primary action and the "you are here" station.
- Fira Sans with tabular numerals for UI and data; Fira Code for code, commands and ids.
- Pills for controls and badges, gently rounded panels, flat depth with ambient shadows.
- Light ("day service") and dark ("night service") themes share every rule.

## Colors

A quiet navy-and-grey service palette with one reserved signal and a set of saturated line colours that never compete with it.

### Primary
- **Signal Yellow** (light `signal-yellow`, dark `signal-yellow-night`): the primary button (the first waiting row's Accept, the main action of a page), the "you are here" station on a line strip, the explorer's selected row station and the knowledge line's position marker. Also the skip link, text selection tint and the hover tint of a concept term, which are momentary pointers to "here". Text on it is always `on-signal` navy.

### Secondary
- **Rail Navy** (light `rail-navy`, dark `rail-navy-night`): the left rail shell, toasts. It stays navy at night and sits clearly apart from the darker ground. Raised rail states (hover, current page) use `rail-navy-raised`.
- **Rail Ink** (`rail-ink`, muted `rail-ink-muted`): text and icons on the rail. The brand mark and the waiting count are white discs/pills with navy text, never yellow.

### Tertiary: the lines
- **Drawer lines**: drawers 0 to 4 are lines with numbered roundels: inbox slate (`drawer-inbox`), world cyan (`drawer-world`), subjects blue (`drawer-subjects`), toolbox green (`drawer-toolbox`), activity violet (`drawer-activity`).
- **Product lines**: products take colours in order from a nine-colour list (blue, green, orange, violet, cyan, magenta, rose, indigo, teal), each with a lighter night variant, so two products never share a line. The list contains no yellow.
- **Category lines**: note categories use the colours of the server's category list (light and night value per category); the client never invents category colours.
- Line colours are applied through a single `--line` custom property on the element, then expressed as a stroke, a station ring, a roundel fill or a badge tint (12% fill, 35% border).

### Neutral
- **Cool Ground** (`ground`, night `ground-night`): the page background behind panels and the explorer list.
- **White Surface** (`surface`, night `surface-night`): panels, the reader, inputs, menus, the palette.
- **Sunk** (`sunk`) and **Hover** (`hover`): inset wells (code, diff, segmented track, pills) and row/button hover.
- **Navy Ink** (`ink`, `ink-secondary`, `ink-tertiary`; night `ink-night`): primary text, secondary text, metadata and placeholders.
- **Hairlines** (`hairline`, `hairline-strong`): row dividers and panel borders; strong for control borders and unpassed stations.
- **Focus Blue** (`focus-blue`): the 2 px focus outline, link underline in prose, info tone.
- **Status** (`ok`, `warn`, `err`, each with a soft background): pills, notices, diff lines and completed steps. Status is a state, not a line.

### Named Rules
**The Reserved Signal Rule.** Signal yellow means "do this" or "you are here". It is never a line colour, a brand colour, a count, a decoration or a status. If a screen shows yellow in two unrelated places, one of them is wrong.

**The Lines Carry Colour Rule.** Hue enters the interface only as a line (drawer, category, product) or a status. Surfaces, text and chrome stay navy and grey.

**The Navy Rail Rule.** The rail is navy in both themes; theme changes the ground, never the shell.

## Typography

**Body Font:** Fira Sans (with system-ui, -apple-system, Segoe UI, sans-serif), weights 400, 500, 600, 700, self-hosted.
**Mono Font:** Fira Code (with ui-monospace, SF Mono, Menlo, monospace), weights 400 and 500.

**Character:** One humanist sans designed for signage and screens carries every role from page titles to station labels; Fira Code is its sibling for anything a person might type or copy.

### Hierarchy
- **Display** (600, 1.875rem, 1.25, -0.015em): a note's title in the reader; drops to 1.5rem under 900 px.
- **Headline** (600, 1.5rem, 1.25, -0.01em): page h1; the flashcard front in Learn.
- **Title** (600, 1.25rem / 1.0625rem, 1.25): section h2 and panel heads (1.0625rem), topbar title (1.0625rem).
- **Body** (400, 0.9375rem, 1.55): the interface default. Controls and secondary text step down to 0.8125rem.
- **Reading body** (400, 1rem, 1.7): note prose, capped at a 72ch measure.
- **Label** (600, 0.75rem): line badges, rail and palette group headings, knowledge-line tier labels, counts. Sentence case, no tracking.
- **Code** (Fira Code, 0.9em of context): inline code, pre blocks, commands, kbd keys, ids.

The scale is fixed rem steps (0.75, 0.8125, 0.9375, 1.0625, 1.25, 1.5, 1.875 rem, ratio about 1.15); no fluid clamp.

### Named Rules
**The Tabular Count Rule.** Every number that can change or be compared (counts, percentages, tables, stats) uses tabular numerals.

**The Sentence Case Rule.** Headings and labels are sentence case at normal tracking; no uppercase labels above titles.

## Layout

A two-column shell: a sticky navy rail of 248 px on the left (brain switcher at the foot, six daily destinations, modules below) and a main column with a sticky translucent topbar (56 px, blurred ground) above the page. Pages are a vertical stack with 24 px gaps, 24 px padding, capped at 1320 px; dashboard pages split into a main and side column at 1.6 : 1.

The notes explorer is a three-pane layout (tree 236 px, list 280 to 360 px, reader) at full viewport height; the reader caps prose at 72ch and adds a 200 px sticky table of contents when the note has headings.

Spacing is a 4 px grid (4, 8, 12, 16, 20, 24, 32, 40, 56 px). Rows are at least 52 px tall with 12 px vertical and 20 px horizontal padding, separated by hairlines.

Responsive behaviour: under 1280 px the explorer tree becomes an off-canvas drawer and the table of contents hides; under 900 px the rail becomes an off-canvas drawer behind a menu button with a scrim, the side column stacks under the main one, and the explorer shows list or reader, one at a time; under 600 px row actions wrap beneath their text and titles wrap instead of truncating.

## Elevation & Depth

Mostly flat, layered by tone: cool ground, white surface on it, sunk wells inside. Shadows are soft and ambient, navy-tinted in light and plain black at night, and grow only with how far a layer floats above the page.

### Shadow Vocabulary
- **Resting** (`--shadow-1`): panels and the pressed segment of a segmented control.
- **Floating** (`--shadow-2`): menus, hover cards, toasts.
- **Overlay** (`--shadow-3`): the command palette and off-canvas drawers.

### Named Rules
**The Tonal First Rule.** Separate with ground, surface, sunk and hairlines before reaching for a shadow; a shadow means the layer floats.

## Shapes

Two families. Everything you press or that names a line is a pill (999 px): buttons, segmented controls, line badges, status pills, the rail count. Everything that holds content has gently rounded corners: 10 px for notices, menus, hover cards, code blocks and toasts, 14 px for panels and the palette; 6 px for inputs, rail links, menu items and the focus ring.

The map vocabulary is circular and linear: station dots are rings (12 px with a 3 px border, 9 px with 2 px when small), roundels are solid discs with a white numeral or initial (26 px, 20 px small), and lines are 3 px strokes with 2 px rounded ends. Borders are 1 px hairlines; dashed borders mark a planned, not yet available module.

## Components

### Buttons
Calm pills; only the primary is loud.
- **Shape:** pill (999 px), 36 px tall, 30 px small, square icon variants.
- **Primary:** signal yellow fill, navy text at 600, border mixed 70% signal with ink. One per context: the action the screen exists for.
- **Default:** white surface, strong hairline border, ink text at 500, 0.8125rem.
- **Ghost:** no border, no fill; hover shows the hover tint.
- **Danger:** error-coloured text with a faint error border; never filled.
- **Hover / Focus:** colour transitions at 150 ms; focus is a 2 px focus-blue outline with 2 px offset. Disabled is 50% opacity.

### Chips and pills
- **Line badge:** a pill tinted with its line colour (12% fill, 35% border), a small station dot inside, label type.
- **Filter chip:** a line badge that toggles; pressed raises the tint to 22% and borders it in the full line colour.
- **Status pill:** 22 px, soft status background with status text.

### Cards / Containers
- **Panel:** white surface, 1 px hairline border, 14 px radius, resting shadow, head 16/20 px padding, body 16 px 20 px 20 px.
- **Rows:** one job per row, actions on the right, hairline dividers.
- **Notice:** sunk or soft status background, 10 px radius, no border.
- **Planned module:** transparent, dashed border, no shadow, muted text.

### Inputs / Fields
- **Style:** 38 px, white surface, strong hairline border, 6 px radius; search fields carry a leading icon.
- **Focus:** 2 px focus-blue outline flush with the border, border turns focus blue.
- **Labels:** 0.8125rem at 500 above the field; help text 0.75rem tertiary.

### Navigation
- **Rail:** navy, 248 px, links 38 px tall with icon, label and optional count. Muted rail ink at rest; hover and current page raise to the lighter navy with full rail ink. The current page's station dot fills signal yellow. The count is a white pill with navy numerals.
- **Brand mark:** white disc, navy letter, on the rail.
- **Topbar:** sticky, translucent ground with blur, hairline below, page title at 1.0625rem.
- **Command palette:** centred overlay at 12vh, 640 px max, 52 px input, 42 px items; selection uses the hover tint.

### Line Strip (signature)
A note's breadcrumb drawn as its line: each ancestor is a small station on the note's category colour, joined by 28 px strokes, ending in the "you are here" station (signal fill, ink ring) with the current label in ink at 600.

### Knowledge Line (signature)
How well OKB knows a repository: a 4 px hairline track with five tier stations (discovery 0, usable 20, solid 45, expert 70, reference 90 percent), the run so far drawn in the repository's product line colour, passed stations ringed in that colour, and a 20 px signal-yellow "you are here" marker with an ink ring. The run and marker slide over 600 ms only when reduced motion is not requested. The current tier label turns ink at 600.

### Brain Map (signature)
Drawers as lines: a numbered roundel, then a 3 px stroke in the drawer's colour with its subjects as stations along it; a station turns signal yellow on hover.

## Do's and Don'ts

### Do:
- **Do** set a line's colour once on the element (`--line`) and let strokes, stations, roundels and badges derive from it.
- **Do** take product colours in order from the nine-colour list and category colours from the server's category list, with their night variants in dark mode.
- **Do** keep exactly one primary (yellow) button per context and mark the current position with the yellow station.
- **Do** use tabular numerals for every count and percentage, and Fira Code for commands, paths and ids.
- **Do** stay on the 4 px grid and the fixed rem scale (0.75 to 1.875 rem).
- **Do** gate movement (slides, smooth scroll, shimmer) behind `prefers-reduced-motion: no-preference`; colour and opacity transitions stay for everyone.
- **Do** keep both themes at WCAG 2.2 AA.

### Don't:
- **Don't** use signal yellow for a line, a brand mark, a count, a status or decoration.
- **Don't** colour surfaces, text blocks or chrome with line colours; lines are strokes, rings, roundels and tints.
- **Don't** turn the rail grey or black at night; it stays navy.
- **Don't** use a cream or warm ground; the ground is cool off-white or deep blue-black.
- **Don't** build pages from equal-size metric tiles with a neon accent on near-black.
- **Don't** add uppercase tracked labels above headings, or use emoji or text glyphs as icons in the interface.
