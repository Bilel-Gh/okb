import { z } from 'zod';

export const CONFIG_VERSION = 1 as const;

export const SOURCE_KINDS = ['vtt', 'markdown', 'html', 'pdf', 'docx', 'code'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CONCEPT_ASSIST_LEVELS = ['off', 'targeted', 'pedagogical'] as const;
export type ConceptAssistLevel = (typeof CONCEPT_ASSIST_LEVELS)[number];

const level = z.enum(CONCEPT_ASSIST_LEVELS);

const answerSchema = z
  .object({
    language: z.string().default('en'),
    /** Legacy, read by nothing. Kept so existing profiles stay valid; use `writing.detail`. */
    style: z.enum(['concise', 'detailed']).default('concise'),
    alwaysCite: z.boolean().default(true),
    maxEvidencePerAnswer: z.number().int().min(1).max(50).default(6),
  })
  .strict();

const profileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, 'profile id must be kebab/snake lowercase'),
    displayName: z.string().default(''),
    /** Actor recorded in `generated.by` for human-authored content. */
    humanActor: z
      .string()
      .regex(/^human:[^\s/]+$/, 'humanActor must look like `human:<id>`')
      .default('human:anonymous'),
    locale: z.string().default('en-US'),
    role: z.string().default(''),
    projects: z.array(z.string()).default([]),
    answer: answerSchema.default({}),
  })
  .strict();

const layoutSchema = z
  .object({
    /** Folder holding the pedagogical concept cards (a product convention). */
    concepts: z.string().default('concepts'),
    /** Where retained source copies go, relative to kb.root. */
    sources: z.string().default('sources'),
    /** Optional landing/navigation files the product may generate. */
    home: z.string().default('index.md'),
    glossary: z.string().default('reference/glossaire.md'),
  })
  .strict();

const kbSchema = z
  .object({
    root: z.string().min(1, 'kb.root is required'),
    layout: layoutSchema.default({}),
    /** Paths inside kb.root that are tooling, not knowledge. Never scanned, never written. */
    exclude: z
      .array(z.string())
      .default(['.okb/**', '.claude/**', '.vscode/**', '.obsidian/**', '.github/**', 'CLAUDE.md', 'AGENTS.md']),
    linkStyle: z
      .object({
        form: z.literal('relative-explicit-extension').default('relative-explicit-extension'),
        explicitDotSlash: z.boolean().default(false),
      })
      .strict()
      .default({}),
    renderers: z
      .array(z.enum(['standard', 'github', 'obsidian']))
      .min(1)
      .default(['standard', 'github', 'obsidian']),
    /** Every new note must follow a note template (`okb template list`). */
    requireTemplate: z.boolean().default(false),
    /**
     * Knowledge that must stay on this machine (company code, client work): no
     * web connector, and `okb doctor` warns when the folder is synchronised by a
     * cloud or the KB has a Git remote. OKB itself never commits nor pushes a KB.
     */
    confidential: z.boolean().default(false),
    /**
     * What the KB is for: a subject (`topic`), one code repository (`repo`: its
     * notes at the root of the KB), or the repositories of a team (`workspace`:
     * one space per repository under `repos/<id>/`, the rest shared). Absent on
     * KBs made before 0.10: inferred (a KB that holds repositories is a workspace).
     */
    kind: z.enum(['topic', 'repo', 'workspace']).optional(),
    /**
     * The space this KB is in (src/spaces): `baggage` is what belongs to the person
     * and follows them for life, `work` is one employer's or one client's. Absent:
     * a career brain is the baggage, any other KB is work.
     */
    space: z.enum(['baggage', 'work']).optional(),
    /**
     * A brain (OKB 1.0): the KB is organised in numbered drawers and subjects
     * (src/brain). Absent on KBs made before 1.0 until `okb brain migrate`.
     */
    brain: z
      .object({
        /** Which drawers and note types: a work brain with products and repositories, personal projects, topics to learn, a portable career. */
        preset: z.enum(['work', 'projects', 'topics', 'career']),
        /** Language of folder and file names (defaults to the writing language). */
        names: z.enum(['fr', 'en']).optional(),
        /**
         * Dashboards and indexes (Maintenant, Glossaire, journal, subject indexes) are
         * computed without AI and shown in the web app, the terminal and to Claude
         * (`app`). With `files`, OKB also prepares them as files through a proposal you
         * approve: nothing is written into a KB without one.
         */
        views: z.enum(['app', 'files']).default('app'),
        version: z.literal(1).default(1),
      })
      .strict()
      .optional(),
    /** Treat links to not-yet-written documents as warnings, per OKF §6.1. */
    brokenTargetsAre: z.enum(['error', 'warning']).default('warning'),
  })
  .strict();

const okfSchema = z
  .object({
    version: z.literal('0.2').default('0.2'),
    /** Actor recorded in `generated.by` for machine-authored content. */
    machineActor: z.string().default('okb/1.0'),
    productRules: z
      .object({
        requiredFields: z
          .array(z.string())
          .default(['type', 'title', 'description', 'status', 'generated']),
        allowedTypes: z.array(z.string()).default([]),
        requireSourcesOnGenerated: z.boolean().default(true),
        forbidSelfVerification: z.boolean().default(true),
      })
      .strict()
      .default({}),
    citations: z
      .object({
        /** Footnote labels key into `sources[].id` (OKF §5.1). */
        style: z.literal('okf-footnote').default('okf-footnote'),
        requireIdWhenCited: z.boolean().default(true),
      })
      .strict()
      .default({}),
  })
  .strict();

const sourcesSchema = z
  .object({
    enabled: z.array(z.enum(SOURCE_KINDS)).default([...SOURCE_KINDS]),
    retention: z
      .object({
        mode: z.enum(['none', 'reference', 'copy']).default('reference'),
        dir: z.string().default('sources'),
        maxBytes: z.number().int().min(0).default(20_000_000),
        /** Regexes applied only to optional raw-text archival copies; working evidence is unchanged. */
        redactPatterns: z.array(z.string()).default([]),
      })
      .strict()
      .default({}),
    limits: z
      .object({
        maxBytes: z.number().int().min(1).default(20_000_000),
        maxBlocks: z.number().int().min(1).default(20_000),
        /** Blocks handed to the model per extraction chunk; drives resumability. */
        chunkBlocks: z.number().int().min(10).default(120),
      })
      .strict()
      .default({}),
  })
  .strict();

const connectorsSchema = z
  .object({
    web: z
      .object({
        enabled: z.boolean().default(false),
        allowDomains: z.array(z.string()).default([]),
      })
      .strict()
      .default({}),
    mcp: z.array(z.string()).default([]),
    /** Explicit opt-in for read-only GitHub ticket observations through the person's existing gh session. */
    github: z.object({
      enabled: z.boolean().default(false),
      host: z.string().regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/).default('github.com'),
      repositories: z.array(z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)).max(100).default([]),
    }).strict().optional(),
  })
  .strict();

export const WRITING_PRESETS = ['standard', 'pedagogique', 'expert'] as const;
export type WritingPreset = (typeof WRITING_PRESETS)[number];

/**
 * How generated and revised articles are written. Every knob except `preset`
 * is optional: an unset knob takes the preset's value, so a profile states only
 * what differs from its starting point. Reliability rules are not here on
 * purpose — they are product rules, not preferences (see src/style/brief.ts).
 */
export const WRITING_KNOBS = {
  detail: ['essential', 'standard', 'thorough'],
  tone: ['neutral', 'warm', 'formal'],
  examples: ['none', 'generic', 'project'],
  analogies: ['off', 'when-useful'],
  diagrams: ['off', 'when-useful', 'prefer'],
  emojis: ['off', 'landmarks'],
  progression: ['usage-first', 'reference'],
  defineTerms: ['inline', 'off'],
} as const;

const knob = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).optional();

/**
 * Sharing through drawers (2.1, src/share): the folder both colleagues reach
 * (a team folder, the local copy of a common repository), the person's own
 * drawer in it, and the day they said this place is allowed by their company.
 */
const shareSchema = z
  .object({
    folder: z.string().min(1),
    drawer: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
    allowedAt: z.string().datetime(),
  })
  .strict();

const writingSchema = z
  .object({
    preset: z.enum(WRITING_PRESETS).default('standard'),
    /** Defaults to profile.answer.language. */
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'language must look like `fr` or `en-GB`').optional(),
    detail: knob(WRITING_KNOBS.detail),
    tone: knob(WRITING_KNOBS.tone),
    examples: knob(WRITING_KNOBS.examples),
    analogies: knob(WRITING_KNOBS.analogies),
    diagrams: knob(WRITING_KNOBS.diagrams),
    emojis: knob(WRITING_KNOBS.emojis),
    progression: knob(WRITING_KNOBS.progression),
    defineTerms: knob(WRITING_KNOBS.defineTerms),
    /** The person's own style and length for one kind of note (a note type id); the product has defaults (src/style/simple.ts). */
    byType: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.object({ preset: z.enum(WRITING_PRESETS).optional(), detail: knob(WRITING_KNOBS.detail) }).strict()).default({}),
    /** A few free-text preferences; short on purpose, they travel with every brief. */
    instructions: z.array(z.string().min(1).max(240)).max(8).default([]),
  })
  .strict();

export const READER_LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export type ReaderLevel = (typeof READER_LEVELS)[number];

/** What the reader already knows. Separate from style and from concept assist. */
const readerSchema = z
  .object({
    level: z.enum(READER_LEVELS).default('intermediate'),
    /** Per-domain override, keyed like conceptAssist.byDomain (`--domain`). */
    byDomain: z.record(z.string(), z.enum(READER_LEVELS)).default({}),
  })
  .strict();

const conceptAssistSchema = z
  .object({
    level: level.default('targeted'),
    /** Per-domain override, keyed by `x_okb.domain`. */
    byDomain: z.record(z.string(), level).default({}),
    limits: z
      .object({
        maxSuggestionsPerSource: z.number().int().min(0).default(8),
        maxLinksPerDocument: z.number().int().min(0).default(12),
        maxLinksPerTermPerSection: z.number().int().min(0).default(1),
        /** Repeats of one term across sections; 1 keeps short articles readable. */
        maxLinksPerTermPerDocument: z.number().int().min(1).default(99),
        prereqDepth: z.number().int().min(0).max(5).default(2),
        minTermOccurrences: z.number().int().min(1).default(1),
        maxCardLines: z.number().int().min(5).default(30),
      })
      .strict()
      .default({}),
    /** Terms the reader already knows — never suggested again. Private to a profile. */
    known: z.array(z.string()).default([]),
    /** Domains the reader wants more help on. */
    deepen: z.array(z.string()).default([]),
    /** Seed vocabulary treated as "fundamental" in pedagogical mode. */
    fundamentals: z.array(z.string()).default([]),
    /** Surface forms never treated as concepts. */
    stoplist: z.array(z.string()).default([]),
  })
  .strict();

const changesSchema = z
  .object({
    prepare: z.enum(['proposal-only', 'proposal-and-preview']).default('proposal-only'),
    apply: z.enum(['require-approval', 'allow-direct']).default('require-approval'),
    /** D71: `review-later` lets the agent file new notes at once, marked to review; only the person sets it. */
    agentWrites: z.enum(['proposal', 'review-later']).default('proposal'),
    diff: z.enum(['unified', 'summary']).default('unified'),
    keepBackups: z.boolean().default(true),
  })
  .strict();

const contextSchema = z
  .object({
    budgets: z
      .object({
        startupTokens: z.number().int().min(100).default(2_500),
        workflowTokens: z.number().int().min(100).default(6_000),
        ingestOutputTokens: z.number().int().min(100).default(4_000),
        connectorTokens: z.number().int().min(100).default(2_000),
      })
      .strict()
      .default({}),
    pageSize: z.number().int().min(1).max(500).default(25),
  })
  .strict();

/**
 * The focus note (written by the person) and the session journal (written by
 * `okb done`). Both live outside the bundle; empty paths default to the profile
 * state. Several profiles may share one focus note.
 */
const focusSchema = z
  .object({
    file: z.string().default(''),
    journal: z.string().default(''),
    /** After this many days the weekly review asks whether the focus is still right. */
    staleDays: z.number().int().min(1).default(14),
    /** Give the focus and the last session to Claude when a session starts (plugin hook). */
    sessionStart: z.boolean().default(true),
  })
  .strict();

/**
 * Natural-language suggestions: when a message looks like an OKB task, the plugin
 * offers the matching command. Only an offer; other knowledge tools named here
 * (a support agent's KB, a wiki) are never touched and make OKB ask first.
 */
const routingSchema = z
  .object({
    suggest: z.boolean().default(true),
    otherKnowledgeTools: z.array(z.string()).default([]),
  })
  .strict();

const gitSchema = z
  .object({
    enabled: z.boolean().default(true),
    requireCleanTree: z.boolean().default(false),
    warnOnDirtyTree: z.boolean().default(true),
    /** Commit each apply and rollback in the KB's own Git repository (touched files only; never pushes). */
    autoCommit: z.boolean().default(false),
    /** Remotes the product may ever push to. Empty means "no push destination". */
    allowedRemotes: z.array(z.string()).default([]),
  })
  .strict();

/**
 * Organisation ceiling. Merged last and only ever *narrows* what the layers
 * above allow — a personal preference cannot widen a policy.
 */
export const policySchema = z
  .object({
    writeAllow: z.array(z.string()).default(['**/*.md']),
    /** All layers' allow groups must match; patterns within one group are ORed. */
    writeAllowGroups: z.array(z.array(z.string())).default([]),
    writeDeny: z.array(z.string()).default(['.git/**', '.okb/**', 'node_modules/**']),
    maxApplyFiles: z.number().int().min(1).default(50),
    /** Ceiling for one indivisible mechanical operation (a migration, a conversion: moves and their links). */
    maxOperationFiles: z.number().int().min(1).default(2000),
    allowDirectApply: z.boolean().default(false),
    allowedRemotes: z.array(z.string()).nullable().default(null),
    allowedSourceKinds: z.array(z.enum(SOURCE_KINDS)).nullable().default(null),
    allowedConnectors: z.array(z.string()).nullable().default(null),
    allowWebConnector: z.boolean().default(true),
    maxConceptSuggestionsPerSource: z.number().int().min(0).default(25),
    maxSourceBytes: z.number().int().min(1).default(50_000_000),
  })
  .strict();

/** D71: the evidence check is offered after a note, or run for risky ones. */
const reviewSchema = z
  .object({
    offer: z.boolean().default(true),
    auto: z.enum(['never', 'risky']).default('never'),
  })
  .strict();

/** Subagents that gather located evidence; writing and the reviewer keep the session's model. */
const agentsSchema = z
  .object({
    model: z.enum(['inherit', 'sonnet', 'haiku', 'opus']).default('inherit'),
  })
  .strict();

export const configSchema = z
  .object({
    version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
    profile: profileSchema,
    kb: kbSchema,
    okf: okfSchema.default({}),
    sources: sourcesSchema.default({}),
    connectors: connectorsSchema.default({}),
    conceptAssist: conceptAssistSchema.default({}),
    writing: writingSchema.default({}),
    share: shareSchema.optional(),
    reader: readerSchema.default({}),
    changes: changesSchema.default({}),
    context: contextSchema.default({}),
    git: gitSchema.default({}),
    focus: focusSchema.default({}),
    routing: routingSchema.default({}),
    policy: policySchema.default({}),
    review: reviewSchema.default({}),
    agents: agentsSchema.default({}),
    /** Root of operational state: proposals, runs, caches, logs. Never inside the KB. */
    stateHome: z.string().default(''),
  })
  .strict();

export type OkbConfig = z.infer<typeof configSchema>;
export type OkbPolicy = z.infer<typeof policySchema>;

/** Partial shape accepted from any single layer before merging. */
export const partialConfigSchema = z.record(z.string(), z.unknown());
