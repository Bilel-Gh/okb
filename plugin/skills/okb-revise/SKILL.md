---
name: okb-revise
description: Rewrite one existing OKB note in another writing style — simpler, more detailed, another reader level or language, with or without analogies, diagrams or emojis — as a reviewable proposal that keeps quotes, code and citations identical. Use when the user asks to rewrite, simplify, restyle or translate a note already in their KB, e.g. « réécris cette fiche plus simplement ». Do not use to add facts from a source, to answer a question, to edit code or to restyle the whole KB at once.
---

# Revise the style of one note

> 📚 **Which KB.** Start your first reply with one line `📚 KB: <profile>` taken from `okb profile --json` (again after any `okb setup switch` or explicit `--profile`), so the user always sees which knowledge bundle is in use. If the session context does not already hold the user's OKB focus, `okb focus --context` gives it: use it silently to choose examples and priorities.

A revision changes prose only. It reads no new source, so it cannot add facts;
new information goes through `okb-ingest`.

1. Turn the user's wording into a one-off style request and read the brief:

   ```bash
   okb style --json [--preset standard|pedagogique|expert] [--set knob=value] \
     [--reader beginner|intermediate|expert] [--note "free text"] [--domain <d>]
   ```

   "plus simple" usually means `--reader beginner --set detail=essential`;
   "sans émojis" means `--set emojis=off`. Nothing is saved to the profile.
   Follow the brief, including its common rules. `draftDir` is where drafts go.
2. Read the whole note (path from the user or `okb ask`). One note per proposal
   unless the user names several. Never restyle notes the user did not ask for:
   `okb maintain` only lists `STYLE_DIFFERS` candidates.
3. Write the revised note to `<draftDir>/<note-name>.md`, outside the KB. Keep
   byte-identical: every source quotation (`>` blockquote that is not a
   `> [!TIP]`/`> [!NOTE]` aid), every fenced and inline code span, every footnote
   reference `[^…]` and footnote definition. Analogies, examples, diagrams and
   explanations may change but only rephrase what the note already says; an
   analogy states where it stops. Leave the frontmatter as it is (only title,
   description and tags may change). Keep every section heading of the note's
   template (`x_okb.template`, see `okb template show <id>`). Every existing
   level-2 heading keeps its wording; landmark emojis may change with the style.
   When translating, explain that headings and protected source excerpts retain
   their original language. Only the prose inside sections changes.
4. Prepare, with the same style flags as step 1:

   ```bash
   okb revise <note.md> --file "<draft>" --reason "<the user's request>" --json
   ```

   If protected elements are reported missing, fix the draft. Never edit the KB
   directly or weaken the draft to pass the check.
5. Show `okb review <id> --diff --json` and continue with the `okb-review`
   workflow: the user approves; you apply only after the grant exists.

A revised note becomes `draft`; a previous verification is kept in
`x_okb.prior_verified` because nobody verified the new wording.
