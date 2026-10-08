---
name: okb-learn
description: Help the user learn and keep what their OKB brain holds — the daily spaced review of cards (concept notes and « Q — R » lines), a quiz on a repository, a product or a note, explaining a notion back in their own words (Feynman), the skills map and learning objectives — with feedback grounded in the notes. Use when the user wants to revise, be quizzed, check understanding, see what they master, or set something to learn. Do not use to add knowledge, answer a factual question once, or audit the KB, nor for another tool's knowledge base.
---

# Learn by recalling, not by re-reading

> 📚 **First reply.** `okb learn --json` (cards due, new ones today, open objectives). Open with `📚 <KB name> · 🃏 <due> à réviser`. Speak the user's language.
> 🧭 **Choices are buttons** (AskUserQuestion, 2–4 options, recommended first with « (recommandé) », one question at a time).
> 🛡️ **Only OKB's own KBs.** Reviewing writes no note: the review state is OKB's own. A gap worth a note is a suggestion card (`okb-capture`).

Every fact you test comes from a note; never invent one to make a question.

## Daily review (the default)

For each card of `due` then `fresh` (at most 15, the user can stop any time):
1. Ask its `front`. Wait for the answer; never reveal it first.
2. Show its `back` and the note (`title`), say what was right and what was missing.
3. Buttons « Encore » · « Difficile » · « Bien (recommandé when right) » · « Facile »;
   then `okb learn grade <id> <again|hard|good|easy> --json` with **their** choice.
End: how many done, the next review date, the subjects that moved (`okb learn map`).

## A quiz on a repository, a product or a note

`okb learn quiz --repo <id> | --product "<name>" | --note <path> --json` gives the
notes' briefs and their cards. Read the notes you test. One question at a time,
from simple to applied: what it is, why it exists, how it works, a case from
their own work, a trap. Feedback quotes the note (`> …` with its link). After 5
to 8 questions: solid, to re-read (sections), questions the notes do not answer.

## Explain it back (Feynman)

« Explique-moi X comme à un collègue qui arrive. » Compare with the note's claims:
what is right, what is missing, what is wrong, the simplest correct wording.
Offer to grade its card.

## The skills map and objectives

`okb learn map --json`: per subject, the share known or mastered (★ mastered,
✓ known, … learning, ○ new). Point at the weakest subject that matters for the
user's focus. Something to learn: `okb learn goal add "<objective>" [--by <date>]
[--subject "<subject>"]`; reached: `okb learn goal done <id>`.

## No card yet

Concept notes and « Q : … — R : … » lines become cards. A training note without
its « À réviser » section, or a notion without its concept card → one suggestion
card (`okb-capture` §2), never written unasked. Last line « ➡️ Prochaine étape : … ».
