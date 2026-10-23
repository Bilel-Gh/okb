import type { UrlRole } from './url-kinds.js';
import type { FileKind, Tier } from './inventory.js';

/**
 * The repository map: what a deterministic scan can establish about a code
 * repository without running anything. Every finding points at the file and
 * line it comes from, so a note built on it can cite the code itself.
 */
export type Evidence = {
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  /** The line as written, trimmed and cut at 200 characters; never a secret value. */
  readonly text: string;
};

export type StackItem = { readonly id: string; readonly label: string; readonly version?: string; readonly evidence: readonly Evidence[] };

export type CommandKind = 'install' | 'start' | 'dev' | 'build' | 'test' | 'lint' | 'deploy' | 'other';
export type Command = {
  readonly name: string;
  /** What to type, from the folder the command belongs to. */
  readonly run: string;
  readonly script?: string;
  readonly kind: CommandKind;
  readonly from: 'package.json' | 'makefile' | 'readme' | 'docs';
  readonly cwd: string;
  readonly evidence: Evidence;
};

export type IfaceKind =
  | 'http-route' | 'cds-service' | 'odata' | 'openapi' | 'graphql' | 'grpc' | 'event' | 'destination' | 'url'
  | 'database' | 'messaging' | 'auth' | 'service-binding' | 'package' | 'ui-app' | 'env-endpoint' | 'container' | 'external-service'
  /** An outgoing HTTP call: `POST /orders`, with its base variable in `detail` (`base ORDERS_URL`). */
  | 'http-call';
/** `role`: for a `url`, what the address is (src/repo/url-kinds.ts, F2.4-15); absent in maps scanned before lot D. */
export type Iface = { readonly kind: IfaceKind; readonly name: string; readonly detail?: string; readonly evidence: Evidence; readonly count?: number; readonly role?: UrlRole };

export type EnvVar = { readonly name: string; readonly evidence: readonly Evidence[]; readonly defaulted: boolean; readonly sensitive: boolean };
export type Environment = { readonly name: string; readonly evidence: readonly Evidence[] };

export type Entity = {
  readonly name: string;
  readonly namespace?: string;
  readonly kind: 'cds' | 'sql' | 'jpa' | 'prisma' | 'abap' | 'mongoose' | 'django';
  readonly evidence: Evidence;
  readonly relations: readonly { readonly to: string; readonly kind: 'association' | 'composition' }[];
};

export type DocFile = { readonly path: string; readonly kind: FileKind; readonly title: string | null; readonly lines: number | null; readonly headings: readonly string[] };
export type CiPipeline = { readonly path: string; readonly system: string; readonly stages: readonly string[]; readonly triggers: readonly string[] };

export type Module = {
  readonly path: string;
  readonly role: string | null;
  readonly files: number;
  readonly lines: number;
  readonly languages: readonly string[];
  readonly readme: string | null;
  readonly changes: number;
  readonly lastChange: string | null;
  readonly authors: readonly string[];
};

export type RiskKind = 'secret-like' | 'tracked-env' | 'no-readme' | 'thin-readme' | 'no-tests' | 'no-ci' | 'doc-drift' | 'todo' | 'large-file';
export type Risk = { readonly kind: RiskKind; readonly detail: string; readonly evidence?: Evidence; readonly params?: Readonly<Record<string, string | number>> };

export type Term = { readonly term: string; readonly count: number; readonly where: readonly string[]; readonly from: 'entity' | 'service' | 'label' | 'doc' };

export type PlanItem = { readonly path: string; readonly lines: number | null; readonly why: string };
export type Area = {
  readonly id: string;
  readonly path: string;
  readonly role: string | null;
  readonly read: readonly PlanItem[];
  readonly skim: readonly PlanItem[];
  readonly indexed: number;
  readonly lines: number;
};

export type QuestionStatus = 'hinted' | 'needs-reading' | 'unknown';
export type QuestionHint = { readonly id: string; readonly theme: string; readonly status: QuestionStatus; readonly hints: readonly Evidence[]; readonly note?: string };

export type RepoMap = {
  readonly version: 1;
  readonly scannedAt: string;
  readonly okbVersion: string;
  readonly repo: {
    readonly id: string;
    readonly name: string;
    readonly root: string;
    readonly remote: string | null;
    readonly branch: string | null;
    readonly defaultBranch: string | null;
    readonly head: string | null;
    readonly headDate: string | null;
    readonly firstCommitDate: string | null;
    readonly commits: number | null;
    readonly dirty: boolean;
    readonly description: string | null;
  };
  readonly files: {
    readonly total: number;
    readonly fromGit: boolean;
    readonly truncated: boolean;
    readonly byTier: Readonly<Record<Tier, number>>;
    readonly languages: readonly { readonly lang: string; readonly files: number; readonly lines: number }[];
    readonly skipped: readonly { readonly reason: string; readonly count: number; readonly examples: readonly string[] }[];
  };
  readonly stack: readonly StackItem[];
  /** Names others can depend on: npm package, Maven artifact, Go module, Python project. */
  readonly published: readonly { readonly kind: 'npm' | 'maven' | 'go' | 'python'; readonly name: string; readonly evidence: Evidence }[];
  readonly modules: readonly Module[];
  readonly docs: readonly DocFile[];
  readonly commands: readonly Command[];
  readonly provides: readonly Iface[];
  readonly consumes: readonly Iface[];
  readonly env: readonly EnvVar[];
  readonly environments: readonly Environment[];
  readonly configFiles: readonly string[];
  readonly entities: readonly Entity[];
  readonly ci: readonly CiPipeline[];
  readonly tests: { readonly frameworks: readonly string[]; readonly files: number; readonly dirs: readonly string[] };
  readonly ownership: {
    readonly codeowners: readonly { readonly pattern: string; readonly owners: readonly string[]; readonly evidence: Evidence }[];
    readonly authors: readonly { readonly name: string; readonly changes: number; readonly areas: readonly string[] }[];
    readonly commitsLastYear: number | null;
  };
  readonly hotspots: readonly { readonly path: string; readonly changes: number; readonly lines: number | null }[];
  readonly central: readonly { readonly path: string; readonly importedBy: number }[];
  readonly glossary: readonly Term[];
  readonly risks: readonly Risk[];
  readonly plan: {
    readonly read: readonly PlanItem[];
    readonly skim: readonly PlanItem[];
    readonly indexed: number;
    readonly readLines: number;
    readonly skimLines: number;
    readonly documents: readonly PlanItem[];
    readonly areas: readonly Area[];
    readonly truncated: boolean;
  };
  readonly questions: readonly QuestionHint[];
};
