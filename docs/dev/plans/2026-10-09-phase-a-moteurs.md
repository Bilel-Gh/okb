# Phase A — moteurs de la 1.1 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les moteurs sans interface de la 1.1 : modules et droits, identité, repos du cerveau et barre de connaissance, phrase courte des concepts, fournisseur d'IA et traduction avec cache.

**Architecture:** Un dossier par moteur sous `src/` (`modules`, `identity`, `knowledge`, `concepts`, `ai`, `translate`), chacun exposé par une commande CLI (`src/cli/commands/*.ts`, déclarée dans `src/cli/index.ts` et `help.ts`) et des routes du site local (`src/web/api-brain.ts`, POST protégés par le jeton via `MUTATING`). Textes en FR/EN dans `src/i18n/v1.{fr,en}.ts`.

**Tech Stack:** TypeScript (Node 22), zod, vitest. Aucune nouvelle dépendance.

**Spec:** `docs/dev/specs/2026-10-09-phase-a-moteurs.md`

**Exécution choisie :** Native (je code chaque tâche moi-même, tests d'abord), puis un relecteur neuf sur toute la branche. L'utilisateur dort et a donné carte blanche : ce choix est noté pour sa relecture.

## Global Constraints

- Rien d'écrit dans une KB sans proposition approuvée ; les moteurs ne font que lire, sauf l'état OKB (`~/.okb`, état du profil).
- Aucun nom, e-mail ou compte de l'ordinateur dans l'identité ; `person.id` = `p-` + 10 caractères `[a-z0-9]`.
- La clé d'API vient de `ANTHROPIC_API_KEY` uniquement, jamais écrite dans un fichier.
- `claude -p` : `--model haiku --tools "" --setting-sources "" --no-session-persistence --output-format json`, env `OKB_HEADLESS=1`.
- Traduction : jamais d'avance ; cache 30 jours sans lecture ; citations, code, Mermaid, YAML et cibles de liens intacts.
- Paliers : Découverte 0–19 · Utilisable 20–44 · Solide 45–69 · Expert 70–89 · Référence 90–100. Poids 30/25/20/15/10.
- Phrase courte : 3 à 25 mots.
- Messages en français simple et en anglais ; aucun vocabulaire d'employeur.

## Review Focus

1. Une note sans titres, ou toute en un bloc de code : la traduction ne doit ni planter ni traduire le code.
2. `claude` absent du PATH ou non connecté : `ai.provider=auto` sans clé doit dire « aucun fournisseur » proprement, pas une pile d'erreurs.
3. Un repo du cerveau qui porte le même nom qu'un repo enregistré : il ne doit pas apparaître deux fois.
4. Une fiche concept dont « En une phrase » commence par un lien ou du gras : extraire le texte lisible, pas la syntaxe.
5. Budget du jour déjà dépassé : la traduction refuse avant d'appeler l'IA, avec le montant.

---

### Task 1: Catalogue des modules et droits

**Files:**
- Create: `src/modules/catalog.ts`, `src/cli/commands/modules.ts`, `tests/modules.test.ts`
- Modify: `src/settings/settings.ts` (réglage `modules.enabled`, type `list`, global, fallback `['dev']`), `src/integrations/system.ts` (`claudeModules`, `installClaudeModule`), `src/cli/index.ts`, `src/cli/commands/help.ts`, `src/web/api-brain.ts`, i18n.

**Interfaces:**
- Produces:
  - `type ModuleId = 'core' | 'dev' | 'devops' | 'sales'`
  - `type ModuleDef = { id: ModuleId; status: 'core' | 'available' | 'planned'; plugin: string | null; features: readonly string[]; profiles: readonly string[]; license: 'free' | 'paid'; name: Localized; pitch: Localized; brings: readonly Localized[] }`
  - `MODULES: readonly ModuleDef[]`
  - `enabledModules(env?): Promise<Set<ModuleId>>` (inclut toujours `core`)
  - `entitled(id: ModuleId): boolean`
  - `featureOn(feature: string, env?): Promise<boolean>`
  - `setModule(id: ModuleId, on: boolean, env?): Promise<Set<ModuleId>>` (refuse `core` et un module `planned` : `OkbError('E_INVALID', …, { key: 'moduleNotAvailable' })`)
  - `claudeModules(): Promise<Record<string, { installed: boolean; version: string | null }>>` (clés = noms de plugins)
  - `installClaudeModule(id: ModuleId): Promise<{ ok: boolean; steps: string[]; error?: string }>`

- [ ] **Step 1: tests** — `modules.test.ts` :
  - `MODULES` contient `core`, `dev`, `devops`, `sales` ; `dev.plugin === 'okb-dev'` ; `devops.status === 'planned'`.
  - avec un `OKB_HOME` vide : `enabledModules()` = `{core, dev}` ; `featureOn('repos')` vrai.
  - `setModule('dev', false)` puis `featureOn('repos')` faux, `featureOn('search')` vrai (feature de `core`).
  - `setModule('core', false)` et `setModule('devops', true)` rejettent avec `key: 'moduleNotAvailable'`.
  - `claudeModules()` avec un faux `HOME` contenant `.claude/plugins/installed_plugins.json` `{"plugins":{"okb-dev@okb":[{"version":"1.0.0"}]}}` → `{'okb-dev': {installed: true, version: '1.0.0'}, okb: {installed: false, version: null}}`.
  - CLI `okb modules --json` liste les 4 modules avec `enabled`, `entitled`, `claude`.
- [ ] **Step 2:** lancer `npx vitest run tests/modules.test.ts` → échec (module absent).
- [ ] **Step 3:** implémenter ; `installClaudeModule` réutilise la logique de `installClaudePlugin` (marketplace add si absente, puis `plugin install <plugin>@okb`). Routes : `GET /api/modules`, `POST /api/modules/toggle {id,on}`, `POST /api/modules/install {id}`.
- [ ] **Step 4:** tests verts, `npm run typecheck` vert.
- [ ] **Step 5:** commit `Modules: catalogue, enabled set, entitlements and Claude install`.

### Task 2: Identité stable et rôle

**Files:**
- Create: `src/identity/person.ts`, `tests/identity.test.ts`
- Modify: `src/settings/settings.ts` (`person.role` choice `['', 'dev', 'devops', 'sales', 'product', 'other']`, global), `src/apply/apply.ts` (reçu : `person`), `src/suggest/suggest.ts` (`setStatus` ajoute `decidedPerson`), `src/cli/index.ts` (`whoami`), i18n.

**Interfaces:**
- Produces: `type Person = { id: string; role: string }` ; `person(env?): Promise<Person>` (crée et enregistre `person.id` dans la config racine au premier appel) ; `newPersonId(): string`.

- [ ] **Step 1: tests** — `newPersonId()` respecte `/^p-[a-z0-9]{10}$/` ; deux appels à `person()` dans le même `OKB_HOME` donnent le même id ; le fichier `config.yaml` contient `person.id` et aucun nom ; un reçu d'application contient `person.id`.
- [ ] **Step 2:** échec attendu.
- [ ] **Step 3:** implémenter (`crypto.randomBytes`), écrire via `writeRootConfig`.
- [ ] **Step 4:** verts.
- [ ] **Step 5:** commit `Identity: a stable person id and role in receipts and decisions`.

### Task 3: Les repos du cerveau, reliés ou non

**Files:**
- Create: `src/knowledge/brain-repos.ts`, `tests/knowledge.test.ts`
- Modify: `src/web/api.ts` (`GET /api/repos` : ajoute les non reliés), `src/web/api-brain.ts` (`POST /api/repos/link`).

**Interfaces:**
- Consumes: `listProducts(config, env)` (`src/brain/products.ts`).
- Produces: `type BrainRepo = { id: string; name: string; product: string; folder: string | null; linked: boolean }` ; `brainRepos(config, env?): Promise<BrainRepo[]>` (un seul élément par nom ; `linked` = enregistré pour ce profil).

- [ ] **Step 1: tests** — sur une démo fictive (`writeDemo`, 2 produits, 2 repos), sans repo enregistré : `brainRepos` rend 2 repos `linked: false` avec leur produit ; après `registerRepo` d'un repo de même nom : 2 éléments, celui-là `linked: true` (Review Focus 3).
- [ ] **Step 2–4:** échec, implémentation, verts. `POST /api/repos/link {folder, path}` appelle la même fonction que `okb repo add <path> --product <produit>`.
- [ ] **Step 5:** commit `Repos: list a brain's repositories even when not linked on this machine`.

### Task 4: La barre de connaissance

**Files:**
- Create: `src/knowledge/level.ts`, `src/cli/commands/level.ts` (ou sous-commande `okb repo level`)
- Modify: `tests/knowledge.test.ts`, `src/web/api.ts` (champ `level` dans `/api/repos` et `/api/repo`), i18n (`knowledge.tier.*`, `knowledge.gap.*`).

**Interfaces:**
- Consumes: `repoStatus`, `freshness` (`src/repo/status.ts`), `scoreBundle`.
- Produces:
  - `type Tier = 'discovery' | 'usable' | 'solid' | 'expert' | 'reference'`
  - `type PartId = 'questions' | 'notes' | 'coverage' | 'work' | 'quality'`
  - `type KnowledgeLevel = { percent: number; tier: Tier; partial: boolean; parts: { id: PartId; weight: number; score: number; measured: boolean }[]; next: { part: PartId; points: number; key: string; params: Record<string, string | number> }[] }`
  - `tierOf(percent: number): Tier`
  - `levelFromFacts(facts: LevelFacts): KnowledgeLevel` (pur, testable)
  - `type LevelFacts = { questions: { answered: number; half: number; total: number } | null; pages: { kind: string; state: 'fresh' | 'changed' | 'stale' | 'missing' }[]; coverage: { read: number; readTotal: number; skim: number; skimTotal: number } | null; work: number; quality: number | null }`
  - `repoLevel(config, repo: { id; name; product?; folder? }, options?): Promise<KnowledgeLevel>` (lit les faits puis appelle `levelFromFacts`)

- [ ] **Step 1: tests** (sur `levelFromFacts`) :
  - tout vide relié → `percent 0`, `tier 'discovery'`, `next.length === 3`.
  - toutes les questions, pages fraîches, couverture complète, 6 notes de travail, qualité 100 → `100`, `'reference'`.
  - mêmes faits avec 2 pages `stale` sur 8 → pourcentage plus bas qu'avec `changed`, plus bas que tout `fresh`.
  - `questions: null, coverage: null` → `partial: true`, pourcentage rapporté à 50 points.
  - `tierOf(19) 'discovery'`, `tierOf(20) 'usable'`, `tierOf(45) 'solid'`, `tierOf(70) 'expert'`, `tierOf(90) 'reference'`.
  - `next` trié par points décroissants.
  - `repoLevel` sur la démo fictive : un repo non relié avec ses pages → `partial: true`, `percent > 0`.
- [ ] **Step 2–4:** échec, implémentation, verts. Pages attendues : `repo-hub`, `repo-start`, `repo-architecture`, `repo-interfaces`, `repo-delivery`, `repo-codemap` (+ `repo-test`, `repo-debug` dans un cerveau). Notes de travail : types `ticket`, `investigation`, `known-error`, `recipe`, `decision`, `conventions`, `procedure` du dossier du repo.
- [ ] **Step 5:** commit `Knowledge level: how well OKB knows a repository, without AI`.

### Task 5: Concepts « En une phrase »

**Files:**
- Create: `src/concepts/one-liner.ts`, `tests/one-liner.test.ts`
- Modify: `src/brain/views.ts` (`GlossaryEntry.oneLiner`), `src/web/api.ts` (`terms` portent `oneLiner`), `src/scores/scores.ts` (−4 structure pour une fiche concept sans phrase), `src/cli/commands/` (`okb concepts check [--suggest]`), `plugin/agents/okb-quality-reviewer.md` (règle), i18n.

**Interfaces:**
- Produces: `oneLiner(body: string, term: string): { text: string | null; reason: 'ok' | 'missing' | 'too-long' | 'too-short' }` ; `conceptsWithoutOneLiner(config, bundle): { path; title; reason }[]`.

- [ ] **Step 1: tests** :
  - `## 🎯 En une phrase\n\nUn contrat qui fixe le niveau de service promis.` → texte exact, `ok`.
  - `## En bref\n\nSLA : un contrat qui fixe le niveau de service.` → `Un contrat qui fixe le niveau de service.` (préfixe « Terme : » enlevé, majuscule).
  - `**SLA** est un [contrat](x.md) de service.` → `SLA est un contrat de service.` (Review Focus 4).
  - 30 mots → `too-long`, `null` ; « SLA. » → `too-short` ; aucune section → `missing`.
  - phrase dans un bloc de code ignorée.
  - `glossary()` d'une démo : chaque entrée a `oneLiner` (string ou null).
  - `scoreBundle` : une fiche sans phrase a une note `no one-line definition`.
- [ ] **Step 2–4:** échec, implémentation, verts.
- [ ] **Step 5:** commit `Concepts: a checked one-line definition, the only text shown on hover`.

### Task 6: Fournisseur d'IA

**Files:**
- Create: `src/ai/provider.ts`, `tests/ai.test.ts`
- Modify: `src/settings/settings.ts` (`ai.provider` choice `['auto','claude-code','api','off']`, global, fallback `auto`), hooks `plugin/hooks/*.mjs` et `plugins/okb-dev/hooks/*.mjs` (sortie immédiate si `OKB_HEADLESS=1`), i18n.

**Interfaces:**
- Produces:
  - `type AiRequest = { system: string; prompt: string; size: 'small' | 'medium'; maxTokens: number }`
  - `type AiResult = { text: string; tokens: { input: number; output: number }; provider: 'claude-code' | 'api' | 'fake' }`
  - `pickProvider(env?): Promise<{ id: 'claude-code' | 'api' | 'fake'; } | null>` (null = aucun)
  - `complete(req: AiRequest, env?): Promise<AiResult>` (lève `OkbError('E_CONFIG', …, { key: 'aiUnavailable' })` sans fournisseur)
  - `claudeArgs(size): string[]` (exporté pour les tests)

- [ ] **Step 1: tests** — `OKB_AI=fake` → `pickProvider` = fake, `complete` renvoie `[fake:<size>] <prompt>` et des tokens > 0 ; `ai.provider=off` → `aiUnavailable` ; `auto` avec un `PATH` sans `claude` et sans clé → `null` (Review Focus 2) ; `claudeArgs('small')` contient `--tools`, `""`, `--setting-sources`, `--no-session-persistence`, `--model`, `haiku` ; chaque hook OKB lancé avec `OKB_HEADLESS=1` sort 0 sans rien écrire.
- [ ] **Step 2–4:** échec, implémentation, verts.
- [ ] **Step 5:** commit `AI provider: Claude Code or an API key, one interface, a fake for tests`.

### Task 7: Traduction avec cache

**Files:**
- Create: `src/translate/translate.ts`, `src/cli/commands/translate.ts`, `tests/translate.test.ts`
- Modify: `src/cli/index.ts`, `help.ts`, `src/web/api-brain.ts` (3 routes), i18n.

**Interfaces:**
- Consumes: `complete` (Task 6), `dailyBudget`, `spentToday` (`src/suggest/suggest.ts`), `glossary`.
- Produces:
  - `type Segment = { kind: 'text' | 'keep'; text: string; section: number }`
  - `segments(body: string): Segment[]` (garde code, Mermaid, citations, notes de bas de page)
  - `estimateTranslation(config, path, lang, scope: 'brief' | 'full'): Promise<{ tokens: number; cached: number; toTranslate: number }>`
  - `translateNote(config, path, lang, scope, env?): Promise<{ title: string; markdown: string; cached: number; translated: number; tokens: number }>`
  - `purgeTranslations(config, now?): Promise<number>`
  - `proposeTranslation(config, path, lang): Promise<Proposal>`

- [ ] **Step 1: tests** (fournisseur `fake`) :
  - `segments` : un bloc ```` ```mermaid ```` et une ligne `> citation` sont `keep` ; une note sans titre = une section ; une note tout en code = rien à traduire et aucun appel (Review Focus 1).
  - `translateNote(…, 'brief')` ne traduit que « En bref » ; un second appel identique = `translated: 0`, `cached > 0`.
  - modifier une section → seule celle-là est retraduite.
  - les cibles de liens `](../x.md)` restent identiques dans le résultat.
  - budget à 0 → `OkbError` `key: 'budgetExceeded'` avant tout appel (Review Focus 5).
  - `purgeTranslations` supprime une entrée lue il y a 31 jours, garde celle d'hier.
  - `proposeTranslation` crée une proposition (pas de fichier écrit dans la KB) dont le chemin finit par ` (EN).md`.
- [ ] **Step 2–4:** échec, implémentation, verts.
- [ ] **Step 5:** commit `Translate: on demand, section by section, cached on disk, within the daily budget`.

### Task 8: Tests solides sous charge

**Files:**
- Modify: les fichiers de test les plus lents (mesure d'abord), `vitest.config.ts` si besoin.

- [ ] **Step 1:** `npx vitest run --reporter=verbose 2>&1 | sort` par durée ; noter les 5 plus lents.
- [ ] **Step 2:** réduire leur coût (dépôts Git de test créés une fois par fichier, moins de `git` lancés), sans allonger les délais.
- [ ] **Step 3:** `npm run release:check` deux fois de suite vert.
- [ ] **Step 4:** commit `Tests: faster repository tests, stable under load`.

### Task 9: Documentation et état

- [ ] Mettre à jour `docs/dev/DECISIONS.md` (décisions D48+ de la phase A, marquées « prises de nuit, à valider »), `docs/guide/` (modules, niveau de connaissance, traduire), le carnet hors dépôt, la mémoire.
- [ ] `npm run release:check` vert, scan des mots privés, commit `Docs: phase A`.
