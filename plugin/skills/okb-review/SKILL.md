---
name: okb-review
description: Review, select, apply or roll back an existing OKB knowledge proposal. Use when the user wants its diff or authorises prepared KB changes, including « applique cette proposition ». Do not use to ingest a source, review code or edit notes directly, nor for another tool's or agent's knowledge base.
---

# Review the exact selected change

> 📚 **Before your first reply.** Run `okb profile --json` once and open with one line `📚 <KB name>` (add ` · 🎯 focus <n> j` when the focus is stale). If the session context lacks the user's OKB focus, `okb focus --context` gives it: use it silently. Speak the user's language.
> 🧭 **Choices are buttons.** Whenever the user must choose (which KB, which proposal, keep or drop, go or not), ask with AskUserQuestion: 2 to 4 options, the recommended one first with « (recommandé) », one question at a time.
> 🛡️ **Only OKB's own KBs.** Never read or write another tool's or agent's knowledge base (a support agent's KB, a wiki, another plugin's folder, `routing.otherKnowledgeTools`). If a request could concern one of them, ask which knowledge base is meant before acting.
> ✍️ **Format.** Short sections, a table for lists, quotations as `>` blocks with `path:line`, and a last line « ➡️ Prochaine étape : … ». OKB refuses secrets (`E_SECRET`): offer a placeholder such as `<API_KEY>`.

1. **What waits.** `okb review --list --json` gives the pending proposals with
   their number (`#1`, `#2`…), a readable title and their size. Show them as a
   short table. Several pending proposals that belong together can become one
   with `okb combine <id> <id>…` (one diff, one approval, one receipt).
2. **Read one.** `okb review <n> --diff --json` (a number, an id prefix or a full
   id). Summarise what changes: files created or modified, the important claims,
   concept cards, contradictions and the preparation notes. To keep only part of
   it, preview the same selection with `--only a,b`; refused cards drop only
   their dependent links; empty or inconsistent selections cannot be applied.
3. **The person approves — never you.** Ask with buttons where they want to do it:
   - « Dans mon terminal (recommandé) » → give them `okb review <n>` (with
     `--kb <name>` if needed): it shows the coloured diff and lets them choose,
     approve and apply in one step;
   - « Dans l'application web » → `okb serve`, page « À relire »: their screen
     asks them to confirm;
   - « Plus tard » → stop here.
   Never run `okb review … --approve`, never drive the web app's approval, never
   read the approval key: the plugin's hook refuses it, and it is the user's
   decision.
4. **Then continue.** Ask « C'est fait ? » with the buttons « Oui, c'est appliqué »
   and « Pas encore ». On yes, check `okb review --list --json` (status
   `applied`) and report in two lines what entered the KB and that `okb undo`
   takes it back. If it is approved but not applied, run `okb apply <id> --json`
   yourself (applying an approved selection is allowed), then report the receipt.
5. A proposal the user drops: `okb review <n> --discard` (nothing is written).
   An interrupted apply: `okb apply <id> --resume`. Staleness (`E_STALE`) means a
   note changed since preparation: offer to prepare it again, never overwrite.

Approval signatures and hooks are workflow controls under one OS account, not
isolation from an adversarial agent with arbitrary shell access.
