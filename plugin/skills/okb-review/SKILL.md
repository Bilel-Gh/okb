---
name: okb-review
description: Review, select, apply or roll back an existing OKB knowledge proposal. Use when the user wants its diff or authorises prepared KB changes, including « applique cette proposition ». Do not use to ingest a source, review code or edit notes directly.
---

# Review the exact selected change

1. Run `okb review --list --json` or `okb review <id> --diff --json`.
   Show the paths, useful content changes, concept candidates and unresolved
   contradictions. Review is separate from technical verification.
2. A selection can include article, concept cards, links and mechanical changes.
   Preview the **same selection** with `okb review <id> --only a,b --diff --json`.
   Refused cards drop only their dependent links; moves must be accepted as a
   complete operation. Empty or inconsistent selections cannot be applied.
3. The CLI's configured approval workflow reserves signing for a person. Give
   the user the exact command for this reviewed selection:
   `okb review <id> --approve --only a,b`.
   Do not run this yourself, read the approval key or use another tool to bypass
   it. Explain this requirement comes from OKB's local approval boundary.
4. After the grant exists, run `okb apply <id> --only a,b --json` if applying is
   authorised. You may omit `--only` to use the exact stored approved selection.
   A different selection or changed payload needs a new grant.
5. Report the receipt and `okb apply --rollback <receipt-id>`.

An interrupted run can resume with `okb apply <id> --resume`. The receipt exists
before the first KB write, so it also supports rollback of an incomplete apply.
Rollback refuses later human edits and preflights backups before changing files.
If staleness or a lock conflict is reported, explain the conflicting file/process;
never remove a live lock or overwrite an edit to make a check pass.

For `--dry-run`, expect no receipt or KB writes. Approval signatures and the hook
are workflow controls under one OS account, not isolation from an adversarial
agent with arbitrary filesystem or shell access.
