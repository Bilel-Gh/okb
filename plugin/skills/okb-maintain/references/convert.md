# Convert notes written before OKB

Goal: a clean OKB KB from an old folder of notes, **without losing a word**. OKB
adds what each note lacks (type, title, description, category), makes links
portable and files each note in its template's folder. Bodies are not
rewritten. Everything goes into one proposal the user approves.

1. **Connected?** `okb kb list --json`. If the folder is not a KB yet, ask its
   **name** (never a person's first name; suggest one from the subject) and
   whether it must stay on this computer, then
   `okb kb add "<folder>" --name "<name>" [--confidential] --json`.
   It never writes a note; it only marks the folder as OKB's.
2. **Scan**: `okb kb convert --kb <id> --json` (pages: `--limit 40 --cursor <n>`).
   Each note comes with its title, headings, an excerpt, what it lacks and a
   guessed template. It also writes the plan skeleton at `planPath`.
3. **Decide, note by note**, from the excerpt (open the file only when it is
   not enough):
   - `template`: one of `templates` (concept, guide, procedure, tutorial,
     process, tool, experience, client-case, decision, meeting, path…);
   - `title`: the topic, clear and short;
   - `description`: one useful sentence **taken from the note itself**: nothing
     the note does not say;
   - `tags` (0–4), `status: "draft"` for an unfinished note;
   - `keep: true` for what must stay as is: other tools' files, daily logs,
     templates, attachment lists;
   - `folder` (default: the template's) or `"."` to leave it where it is;
     `name` to rename (default: the file name in kebab-case). A note about one
     of the KB's repositories (`repos` in the scan; `guess.repo`) goes to
     `repos/<id>/`; what spans several repositories stays in the general folders.
   Ask the user only about real doubts (one question, buttons): a whole family
   of notes, a duplicate, a note with no clear subject.
4. **Write the plan** (`version: 1`, `links`, `move`, `notes`) to `planPath`,
   then `okb kb convert --kb <id> --plan-file "<planPath>" --json`. Fix the
   problems it lists, if any. `manualLinks` are links it could not resolve: list
   them for the user; they stay as they were.
5. **Present**: how many notes are converted, filed, kept, and the links made
   portable; then « Relire dans l'app web (okb serve) » · « Voir le diff ici » ·
   « Plus tard ». **Never approve.**
6. **After apply**: `okb nav --kb <id> --json` (home page and indexes) and
   `okb maintain --kb <id> --json`. Offer, for the few most important notes, a
   rewrite into their template with the `okb-revise` workflow, one note at a
   time.
