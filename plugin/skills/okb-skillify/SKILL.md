---
name: okb-skillify
description: Turn a procedure, process or automation note from the user's OKB knowledge base into a Claude Code skill, refined with the user one question at a time and tested on a real case. Use when the user wants a reusable skill or slash command from a documented way of working (« transforme ce process en skill »). Do not use to write a KB note, to ingest a source or to edit the okb plugin's own skills.
---

# From a process to a skill

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

A skill stays the user's method. A draft the AI fills in without the user's review
gives a generic skill that nobody knows how to fix when it goes wrong.

1. **Find the note.** `okb ask "<topic>" --json`; prefer notes of type `Runbook`,
   `Process` or `Automation`. Confirm the note with the user.
2. **Draft.** `okb skillify <note> --json` writes nothing. It reuses the note's
   when-to-use, prerequisites, steps, checks and troubleshooting, and cites the
   note. "No steps section" means the note is not a procedure: offer to write one
   first (`okb-ingest`, template `procedure` or `process`).
3. **Choose where it lives.** Recommend a project skill:
   `<project>/.claude/skills/`. Never write to `~/.claude/skills` or another
   global location unless the user explicitly asks: it would apply everywhere.
4. **Refine, one question at a time**, each with your proposed answer:
   - the trigger: the exact situations and phrases that should start it, and when
     not to use it — this becomes the `description`;
   - each step: still true in their practice? a missing decision, input or output?
   - the check at the end and what to do when it fails;
   - the tools and commands it may run. Anything binding (send, pay, delete,
     publish) keeps an explicit confirmation from the user.
5. **Write.** `okb skillify <note> --out <dir> [--name <name>]`, then apply the
   agreed edits to `SKILL.md`. Remove the draft banner once the user is satisfied.
6. **Test now on a real case**: run the skill and watch it. Fix the step that went
   wrong, then test again.
7. If the work revealed something missing from the note, capture it
   (`okb capture`): the note improves later through a reviewed proposal.

Never put a secret in a skill: name the environment variable instead.
