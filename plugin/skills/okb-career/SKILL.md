---
name: okb-career
description: Keep the user's career side of their OKB brain — achievements told as STAR stories with their proofs, feedback received, yearly goals, one-on-one and annual review preparation, the development plan against a career grid, the living CV — and check that nothing of the employer leaks before a portable copy. Use when the user did something worth remembering (« j'ai réussi », « garde ça pour mon entretien »), gets feedback, prepares a one-on-one or annual review, sets goals, or wants their career notes to take with them. Do not use for project or ticket notes, or for another tool's knowledge base.
---

# My career, proved by what I did

> 📚 **First reply.** `okb career --json` (stories, feedback, goals, last one-on-one, hints). Open with `🧭 Carrière · 📚 <KB name>`. Speak the user's language.
> 🧭 **Choices are buttons** (AskUserQuestion, 2–4 options, recommended first with « (recommandé) », one question at a time).
> 🛡️ **Nothing written without a yes**: each note starts as a suggestion card (`okb-capture` §2). Career notes are personal: offer `confidentiality: secret` for feedback and reviews.
> 🔒 **Never a colleague's first name** unless the user writes it; a role instead (« mon manager »).

Career notes live in `4 Activité/Carrière/` of the work brain: the year's
achievements, goals, feedback, reviews, the development plan, the grid.

## A story worth keeping (STAR)

Moments: a ticket done that mattered, a problem solved, a presentation, a
compliment, a number that moved. Ask only what is missing, one question at a time:
**Situation** (context, stakes) · **Tâche** (what was expected of them) ·
**Action** (what *they* did, « je ») · **Résultat** (a number when there is one,
else a visible effect) · **Compétences** · **Preuves** (links to the ticket note,
the PR, the meeting). Then a card:
`okb suggest add --type achievements --title "<date> — <title>" --why "…" --signal solved --json`,
and with the yes, append it to the year's note as a dated section (`okb-ingest`
`--append "<year note>" --heading "<date> — <title>" --suggestion <id>`).

## Feedback, goals

- Feedback: what was said (their words), strength or to work on, what they will
  do → a `feedback` card (date-title).
- Goals: the year's note with `- [ ]` lines, each measurable and dated; progress
  links to stories.

## Prepare a one-on-one or an annual review

`okb career prep one-on-one --json` (30 days) or `prep annual` (a year;
`--since <date>`): stories, tickets done, feedback, goals, the previous review.
Draft the talking points on its template (`okb template show one-on-one` /
`annual-review`): wins with proofs, blockers, asks, follow-up of the previous
actions; for the annual, goals self-assessed with evidence and wishes. After the
meeting, a card for its note.

## Development plan and grid

When a grid exists, compare its expected skills with `skills` from the stories:
strengths (many proofs), gaps (none) → a development plan (`development-plan`
template), each gap with an action and a learning objective (`okb learn goal add`).

## Taking it with you

`okb career check [--words "a,b"] --json` lists what would leak: product, client
and repository names, ticket refs, emails, internal links, amounts, their own
words. Propose a general rewording for each (« un produit de facturation »,
« une réduction de 30 % des erreurs ») through revision proposals. Once clean,
`okb career export <new folder>` copies the notes; offer `okb init --brain career`
on it. Last line « ➡️ Prochaine étape : … ».
