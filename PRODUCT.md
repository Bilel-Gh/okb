# Product

<!-- impeccable:product-schema 1 -->

> Written on the night of 8–9 October 2026 without the owner's interview (they
> were asleep and had asked the work to go on alone). Facts come from the
> owner's own words in the roadmap and the repository; lines marked
> **[inferred]** are assumptions to confirm.

## Platform

web

## Stack

Delegated (owner, roadmap §2.C): the local web app moves to **React + TypeScript
+ Vite**, migrated page by page, served by the existing local Node server
(`okb serve`), with shared types between server and interface.

## Users

- **Primary: a developer** who joins or works on code they did not write
  (several repositories, tickets, a product to understand) and keeps a personal
  knowledge base with Claude Code. Uses it all day, beside the editor and Claude:
  find a note in seconds, read it, accept or decline what Claude suggests keeping,
  review cards, follow a repository's knowledge level.
- **Next:** a few colleagues of the same team (first shared use), then other
  profiles through modules (devops, sales) — each with their own brain.
- **[inferred]** Mostly French-speaking at first; the interface exists in French
  and English, French-first.

## Product Purpose

OKB is a **local second brain**: Claude reads sources and code and drafts notes;
OKB checks every claim against an exact quote, files each note at its place in the
brain (drawers → subjects → repositories → tickets), shows the change, and writes
nothing without the person's yes. The web app is the main door: everyone can use
it, with or without Claude Code.

Success (owner's criteria, roadmap §2.D): a newcomer finds a note and accepts a
suggestion without help in under 2 minutes; no page without a useful empty state;
everything works with the keyboard.

## Positioning

What a neighbouring tool cannot truthfully copy in an afternoon (roadmap §8.2):
knowledge **verified and kept true** (every sentence tied to evidence, notes that
flag themselves stale when the code changes), a **knowledge level proved by an
exam**, **diagrams computed from the code**, and **trust**: local first, nothing
written without human approval, receipts and undo, 🔒 notes.

## Operating Context

- Runs on the person's computer: `okb serve` opens `http://127.0.0.1:4317`. Notes
  are Markdown files in folders the person owns (also readable in Obsidian).
- Used next to Claude Code (a plugin and modules) and the terminal (`okb`).
- Daily rituals: find and read, the « Maintenant » dashboard, accept or decline
  suggestion cards, review proposals (a diff), spaced review of cards, end of
  session, weekly review; for developers, onboarding a repository and following a
  ticket.
- Company code can be involved: confidentiality matters (🔒 notes, confidential
  KBs, nothing leaves the machine unless the person asks).

## Capabilities and Constraints

- Pages today: home, « Maintenant », brain (drawers and subjects), notes (reader,
  history, versions), search (⌘K), graph, categories, review (proposals), inbox,
  learn (FSRS cards), career, weekly, focus, repos, KBs, settings, usage, health,
  tools. To come: modules, « use OKB in Claude Code », translate, concept bubbles,
  knowledge bars, hybrid search and « ask your brain », XP and badges.
- Every change goes through the server with a session token; approvals stay human.
- Bilingual (FR/EN) messages from the server's catalogue (`/api/i18n`).
- Must work offline, from a local server, with no external fonts or CDNs.
- Large brains: thousands of notes (lists must stay fluid at 5,000).

## Brand Commitments

- Name: **OKB**. The brain metaphor (🧠, drawers, subjects) and the existing note
  category colours are part of the product's language.
- Voice: plain, short, French-first, explains every term, never jargon for its own
  sake; asks before acting.
- **[inferred]** No logo beyond the favicon; no binding typeface or palette.

## Evidence on Hand

- A fictitious demo brain (`okb brain demo`): ~400 notes, products Atlas, Cassini,
  shared « Socle commun », repositories and tickets. Use it for every screen.
- No testimonials, customers, metrics or press: none may be invented.

## Product Principles

1. **Nothing without a yes.** Every write is shown and approved by the person.
2. **Find in three seconds.** Search and navigation come before decoration.
3. **Explain, don't impress.** Each page answers one question (« where am I? »,
   « where is my note? », « what waits for my yes? »); three clicks at most for
   daily actions.
4. **Local and trustworthy.** Show provenance, freshness and confidentiality
   plainly.
5. **Calm by default.** A tool used all day: quiet surfaces, strong hierarchy,
   colour for meaning (categories, states), not for noise.

## Accessibility & Inclusion

- Everything by keyboard (owner's requirement), visible focus, screen-reader names.
- Contrast WCAG 2.2 AA in light and dark themes; respects reduced motion.
- Narrow screens supported (reading on a laptop beside the editor, a phone for
  review).
