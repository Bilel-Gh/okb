# Lot E — Valider en un geste : plan d'implémentation

> For agentic workers: executed inline (superpowers:executing-plans), tests first; checkbox steps.

**Goal:** an agent's new notes enter the KB at once as « à relire »; the person sorts them later in one screen without terminal or system dialog; validated notes change only with the person's yes; a « validated » share measures KB upkeep.

**Architecture:** review state in SQLite (`note_reviews`, migration 9), no rewrite of notes. The agent still prepares proposals; a new engine operation `notes.keep` applies the part that may go in directly (`policy:review-later`) and leaves the rest prepared. Person gestures are engine operations (`agents: false`). The web server gives the browser it opens a session key in an HttpOnly cookie; approval routes accept it instead of the presence dialog.

**Spec:** `docs/dev/specs/2026-10-20-lot-e-valider-en-un-geste.md`. Mockups: `maquettes-lot-e/` (outside the repo).

## Global Constraints

- Default `changes.agentWrites: 'proposal'`: nothing changes for a KB that did not opt in.
- Only the person changes the setting; an agent never validates, rejects, approves a change or changes the setting.
- Guards unchanged: path policy, secrets, confidentiality, max files; a refused proposal is not applied.
- No note file is rewritten to record review state.
- Atelier theme, fr/en, dark mode, colour always with a word, keyboard reachable.
- No commit with co-author; no push.

## Review Focus

1. A proposal mixing a new note and a change to a validated note → split, never fully applied (Task 3).
2. A note moved or renamed outside OKB → review state follows its OKF id, else falls back to « à relire » rather than « validée » (Task 2).
3. `okb serve --no-open`, or a second browser → no cookie, presence fallback, not a silent approval (Task 5).
4. « Non » on one note of a multi-note receipt → only that note goes (Task 4).
5. KB with zero notes → share shown as « — », not 0 % or NaN (Task 6).

---

### Task 1: Setting and guard (F2.0-52)
Files: `src/config/schema.ts` (`changes.agentWrites`, `review.offer`, `review.auto`), `src/engine/ops/settings*` or a new `review.settings` op (`agents: false`), `plugin/hooks/hooks.json` + `guard-approval.mjs` (deny tool edits of `profile.yaml` keys `agentWrites`), tests `tests/review-settings.test.ts`.
- [ ] tests: default `proposal`; person sets `review-later`; agent refused (`E_NOT_APPROVED`); hook denies `sed … agentWrites` and an Edit of profile.yaml containing it.
- [ ] implement; run; checkpoint.

### Task 2: Review state (F2.0-53)
Files: `src/state/db.ts` (migration 9: `note_reviews(path PK, note_id, state, by, at, sha256, reason, receipt_id)`), `src/review/state.ts`: `classifyNotes(config, bundle)`, `reviewOf(config, path, bundle?)`, `setReview(...)`, `pendingList(config)`, `validatedShare(config, bundle)`; tests `tests/review-state.test.ts`.
- [ ] tests: classification (human-approved receipt → validated; no `generated` → validated; generated without human receipt → pending; reserved excluded; idempotent; no file changed); moved note follows id; unknown path → pending; share 0/50/100 and empty KB → null.
- [ ] implement; run; checkpoint.

### Task 3: The agent's write path (F2.0-54)
Files: `src/apply/apply.ts` (accept `options.policy: 'review-later'` only from `src/review/keep.ts`), `src/review/keep.ts` `keepProposal(config, proposalId, actor)` → `{ applied: path[], waiting: proposalId | null }`, op `notes.keep` (agents allowed), CLI `okb keep <proposal>`; tests `tests/review-keep.test.ts`.
- [ ] tests: create → applied + pending + reason; change of pending → applied; change of validated → stays prepared; mixed → split (new proposal for the waiting part); `proposal` mode → nothing applied; guard refusal → nothing applied; receipt `approvedBy: policy:review-later`.
- [ ] implement; run; checkpoint.

### Task 4: The person's gestures (F2.0-55)
Files: `src/review/gestures.ts`, ops `notes.review.list|validate|reject|move|approveChange|yesToAll|requestCheck` (`agents: false` except list), web routes, `note_requests` (migration 9), tests `tests/review-gestures.test.ts`.
- [ ] tests: validate; reject a created note (file gone, other notes of the receipt kept, backup kept); reject a pending modification (text restored); reject a waiting change (proposal superseded); move with links and state following; approveChange keeps validated; yesToAll except; requestCheck listed in the brief; agent refused on each.
- [ ] implement; run; checkpoint.

### Task 5: Approval in the app without dialog (F2.0-56)
Files: `src/web/server.ts` (session key, one-time `/?k=` link, HttpOnly SameSite=Strict cookie), `src/web/presence.ts` (cookie → confirmed), routes approve/evening/review, `plugin/hooks/guard-approval.mjs` (review routes); tests `tests/web-session.test.ts`.
- [ ] tests: cookie → approve without dialog; no cookie → presence path; wrong origin refused; link usable once; hook denies curl to `/api/notes/review/validate`.
- [ ] implement; run; checkpoint.

### Task 6: Indicator (F2.0-57)
Files: `src/indicators/indicators.ts`, `src/projects/today.ts` (`memory: { pending, share }`), status API for the status bar; tests in `tests/indicators*.test.ts`, `tests/today.test.ts`.
- [ ] tests: share and counts; Today line data; empty KB `share: null`.
- [ ] implement; run; checkpoint.

### Task 7: The app
Files: `web-app/src/pages/review/*` (À relire screen with list by day, detail, diff, tree picker, keyboard O/N/←/→, Tout est trié), reader banner + state badges, Settings section, Today line, status bar; journey `tests/journeys/review.journey.ts`.
- [ ] journey: sort a day (Oui, Non, Déplacer, Oui à tout sauf), a change to a validated note, Today line and status bar, dark mode, no console error.
- [ ] implement on the mockups; run; checkpoint.

### Task 8: Agent side
Files: `plugin/skills/okb-capture/SKILL.md`, `plugin/skills/okb-ingest/SKILL.md` (asked note = consent, `okb keep`, one-line announcement, relecture offer), `src/work/brief.ts` or the core session brief (pending count, check requests); budget tests (`tests/packaging.test.ts`).
- [ ] tests: brief lines; packaging budgets; validators.

### Task 9: Docs and gate
D71 in DECISIONS (amends D25 and the « every KB mutation is approved » rule), repo `CLAUDE.md` rule line, guide « valider-les-notes.md », README, DESIGN, release note; `npm run release:check`, journeys, leak scan, fresh review, fixes test-first, local commit.
