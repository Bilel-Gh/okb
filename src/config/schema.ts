import { z } from 'zod';

export const CONFIG_VERSION = 1 as const;

export const SOURCE_KINDS = ['vtt', 'markdown', 'html', 'pdf', 'docx'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CONCEPT_ASSIST_LEVELS = ['off', 'targeted', 'pedagogical'] as const;
export type ConceptAssistLevel = (typeof CONCEPT_ASSIST_LEVELS)[number];

const level = z.enum(CONCEPT_ASSIST_LEVELS);

const answerSchema = z
  .object({
    language: z.string().default('en'),
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
    /** Treat links to not-yet-written documents as warnings, per OKF §6.1. */
    brokenTargetsAre: z.enum(['error', 'warning']).default('warning'),
  })
  .strict();

const okfSchema = z
  .object({
    version: z.literal('0.2').default('0.2'),
    /** Actor recorded in `generated.by` for machine-authored content. */
    machineActor: z.string().default('okb/0.2'),
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

const gitSchema = z
  .object({
    enabled: z.boolean().default(true),
    requireCleanTree: z.boolean().default(false),
    warnOnDirtyTree: z.boolean().default(true),
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
    allowDirectApply: z.boolean().default(false),
    allowedRemotes: z.array(z.string()).nullable().default(null),
    allowedSourceKinds: z.array(z.enum(SOURCE_KINDS)).nullable().default(null),
    allowedConnectors: z.array(z.string()).nullable().default(null),
    allowWebConnector: z.boolean().default(true),
    maxConceptSuggestionsPerSource: z.number().int().min(0).default(25),
    maxSourceBytes: z.number().int().min(1).default(50_000_000),
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
    changes: changesSchema.default({}),
    context: contextSchema.default({}),
    git: gitSchema.default({}),
    policy: policySchema.default({}),
    /** Root of operational state: proposals, runs, caches, logs. Never inside the KB. */
    stateHome: z.string().default(''),
  })
  .strict();

export type OkbConfig = z.infer<typeof configSchema>;
export type OkbPolicy = z.infer<typeof policySchema>;

/** Partial shape accepted from any single layer before merging. */
export const partialConfigSchema = z.record(z.string(), z.unknown());
