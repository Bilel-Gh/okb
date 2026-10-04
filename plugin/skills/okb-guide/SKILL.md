---
name: okb-guide
description: Show where the user's OKB second brain stands and what they can do next, as a short dashboard with buttons. Use when the user asks what OKB can do, how to use it, where they stand (« où j'en suis avec OKB », « aide OKB »), or seems unsure which OKB command to use. Do not use for a task another OKB skill handles, or for another tool's knowledge base.
---

# OKB at a glance

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

1. Run `okb status --json` (and `okb kb --json` when the user has several KBs).
2. Show a five-line dashboard: the KB and its number of notes; the focus (age,
   stale or missing); the last session's « next time »; the inbox; the proposals
   waiting (number, title). Mention the web app (`okb serve`) once.
3. Offer the two or three actions that make sense now, as buttons, the most
   useful first: proposals waiting → review them; no focus → write it; inbox not
   empty → sort it; end of the day → end the session; Monday → weekly review;
   otherwise → ask a question or import a source.
4. Run the workflow the user picks (its own skill), or give the terminal command
   when it needs the person (approving: `okb review <n>`).

When the user asks « what can OKB do? », answer in six lines at most: import a
source into reliable, sourced notes (nothing enters without their approval),
find answers with quotations, capture and sort ideas, keep a focus and a session
journal Claude reads, weekly review and revision, turn a procedure into a skill.
Then offer the guided tour: `okb tour` (a throwaway KB, nothing touched).
