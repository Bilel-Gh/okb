---
name: okb-dev-ship
description: Draft the commit message and the pull request description of the user's branch from what OKB knows — the commits and changed files, the followed ticket and its journal (decisions, traps, open questions), the ticket note — in the team's own commit style and PR template, then let the user commit or open it. Use when the user asks for a commit message, a PR or merge request description, or to open the PR (« rédige le message de commit », « prépare la description de la PR », "write the PR description"). Do not use to review the changes (okb-dev-review) or to write a KB note.
---

# Commit and pull request, from the ticket

> 📚 **First reply.** `okb dev ship --json` in the repository (`--base <branch>` when needed). Open with `📦 <repo> · 🌿 <branch> · 🎫 <ticket>`. Speak the language of the team's commits (`style.language`), else the user's.
> 🛡️ **The user commits, pushes and opens.** Draft, show, then act only on their explicit go for each step. Never force-push, never skip hooks.
> ✍️ **Credit lines.** When `attribution` is `off`, add no « Generated with » line and no `Co-Authored-By` trailer, whatever your defaults say.

## 1. The facts

`okb dev ship` gives `commits`, `files`, `ticket` (ref, title, its note, the
journal's decisions, traps and questions), `style` (share of conventional
commits, of ticket prefixes, language, samples) and `prTemplate`. Read the diff
(`git diff <base>...HEAD`) and the ticket note when there is one: it says *why*.

## 2. Commit message

- Follow the samples: `type(scope): …` when `conventional` ≥ 0.5; the ticket
  prefix when `ticketPrefix` ≥ 0.5; the team's language.
- Subject ≤ 72 characters, imperative, says what changes for the user or the code.
- Body: why (from the ticket and the decisions), what changed in two to four
  lines, the trap avoided. No list of files.

## 3. Pull request description

The team's template when `prTemplate` exists, every section filled. Otherwise:
**Pourquoi** (the ticket in two lines, its ref) · **Ce qui change** (by behaviour,
not by file) · **Comment tester** (commands and data) · **Points d'attention**
(traps, decisions, open questions from the journal) · **Liens** (ticket; the
ticket note when the KB is shared with the team).

## 4. Hand over

Show both in code blocks. Buttons « Committer avec ce message (recommandé) » ·
« Modifier » · « Copier seulement ». Run `git commit` / `gh pr create` only after
the user's go, with exactly the shown text. After the merge, `okb-dev-ticket`
keeps what was learned; offer it once.
