---
description: Set up or show a workspace — the folder holding a team's repositories, documented in one KB with one space per repository — and narrow OKB to the repository or ticket at hand.
argument-hint: "[folder | repository | ticket]"
disable-model-invocation: true
---

Use the `okb-guide` skill. Run `okb workspace --json` and `okb scope --json` in the current folder.
- No workspace yet: explain in two lines (one KB for the team's repositories, one space per repository, a shared part for what spans them; one repository alone is better served by a repository KB). Ask with buttons which folder holds the repositories (the current folder first if it holds Git repositories) and which KB (« Une nouvelle KB de travail, sur cet ordinateur (recommandé) » or an existing one; a new one: ask its name, never a first name). A KB written before OKB in that folder: `okb kb add <folder>` first, then `okb workspace add`, then `/okb:convert`. Run `okb workspace add <folder> --kb <id> --json` (or `--new-kb "<name>"`); `advice: single-repo` → offer a repository KB instead. Show the repositories found (🔗 attached ones keep their own KB), the ticket prefixes learned, the landscape proposal to review, and the habit: open Claude Code in the repository of the ticket.
- A workspace exists: show its repositories (documented or not), the scope and the tickets in progress (`okb ticket list --json`), then ask ONE question with buttons: narrow to a repository (`okb scope <repo>`), start a ticket (`/okb-dev:ticket`), document an undocumented repository (`/okb-dev:onboard`), or review the landscape.
The user adds: $ARGUMENTS
