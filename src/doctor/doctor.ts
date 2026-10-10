import { readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OkbConfig } from '../config/schema.js';
import { OKF_SPEC_PIN } from '../okf/types.js';
import { supportMatrix } from '../sources/registry.js';
import { statePaths } from '../state/paths.js';
import { measure, totalMeasure, type Measure } from '../util/context-meter.js';
import { exists, readTextIfExists, walkFiles } from '../util/fsx.js';

export type Check = {
  readonly name: string;
  readonly status: 'ok' | 'warn' | 'fail' | 'unknown';
  readonly detail: string;
  readonly hint?: string;
};

export type DoctorReport = {
  readonly checks: readonly Check[];
  readonly support: ReturnType<typeof supportMatrix>;
  readonly context: ContextFootprint;
  readonly ok: boolean;
};

export type ContextFootprint = {
  /** Loaded in every session as soon as the plugin is installed. */
  readonly alwaysOn: Measure;
  /** Loaded when a workflow is selected. */
  readonly perWorkflow: readonly Measure[];
  /** Loaded only inside a subagent. */
  readonly perAgent: readonly Measure[];
  readonly notes: readonly string[];
};

export function pluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/doctor/doctor.js -> package root, or src/doctor/doctor.ts -> package root
  return resolve(here, '..', '..', 'plugin');
}

/**
 * Measure what the product costs in context.
 *
 * Byte counts are exact. Token counts are an estimate from a fixed divisor,
 * because no tokenizer is bundled — the distinction is kept in the output so a
 * reader never mistakes one for the other.
 */
export async function measureContext(root = pluginRoot()): Promise<ContextFootprint> {
  const notes: string[] = [
    'Byte counts are measured. Token counts are estimated (bytes ÷ 3.8) — no tokenizer is bundled.',
  ];

  if (!(await exists(root))) {
    return {
      alwaysOn: measure('plugin (not found)', ''),
      perWorkflow: [],
      perAgent: [],
      notes: [...notes, `plugin directory not found at ${root}`],
    };
  }

  const files = await walkFiles(root);
  const read = async (rel: string) => (await readTextIfExists(resolve(root, rel))) ?? '';

  const alwaysOnParts: Measure[] = [];
  for (const rel of files) {
    // Manifest bytes are not assumed to be injected into model context.
    // Only frontmatter of commands and skills is resident; bodies load on demand.
    if ((rel.startsWith('commands/') || rel.startsWith('skills/') || rel.startsWith('agents/')) && rel.endsWith('.md')) {
      const text = await read(rel);
      if (!/disable-model-invocation:\s*true/.test(frontmatterOf(text))) alwaysOnParts.push(measure(`${rel} (metadata proxy)`, frontmatterOf(text)));
    }
  }

  const perWorkflow: Measure[] = [];
  for (const rel of files.filter((f) => f.startsWith('skills/') && f.endsWith('SKILL.md'))) {
    perWorkflow.push(measure(rel, await read(rel)));
  }
  for (const rel of files.filter((f) => f.startsWith('commands/') && f.endsWith('.md'))) {
    perWorkflow.push(measure(rel, await read(rel)));
  }

  const perAgent: Measure[] = [];
  for (const rel of files.filter((f) => f.startsWith('agents/'))) {
    perAgent.push(measure(rel, await read(rel)));
  }

  return {
    alwaysOn: totalMeasure('potential always-on metadata (estimate of exposure, not live runtime context)', alwaysOnParts),
    perWorkflow,
    perAgent,
    notes: [
      ...notes,
      'Runtime context is not measured here; use /context in the actual Claude session, including its other plugins and MCPs.',
      'Ingestion output is bounded by context.budgets.ingestOutputTokens and paginated; truncated output carries a resume cursor.',
      'Script bodies are never injected: the CLI is executed and only its summary is read.',
    ],
  };
}

function frontmatterOf(text: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[0] : '';
}

export async function doctor(config: OkbConfig | null, error?: Error): Promise<DoctorReport> {
  const checks: Check[] = [];

  // 22.13 is the first version whose own SQLite (the operational state) needs no flag.
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  checks.push({
    name: 'node',
    status: nodeOk ? 'ok' : 'fail',
    detail: `v${process.versions.node}`,
    ...(nodeOk ? {} : { hint: 'okb requires Node 22.13 or newer.' }),
  });

  if (!config) {
    checks.push({
      name: 'configuration',
      status: 'fail',
      detail: error?.message ?? 'configuration could not be loaded',
      hint: 'Run `okb setup` to create a profile.',
    });
    return {
      checks,
      support: [],
      context: await measureContext(),
      ok: false,
    };
  }

  checks.push({
    name: 'configuration',
    status: 'ok',
    detail: `profile "${config.profile.id}", kb.root ${config.kb.root}`,
  });

  checks.push(
    (await exists(config.kb.root))
      ? { name: 'kb.root', status: 'ok', detail: config.kb.root }
      : {
          name: 'kb.root',
          status: 'fail',
          detail: `${config.kb.root} does not exist`,
          hint: 'Create it, or point kb.root elsewhere.',
        },
  );

  const state = statePaths(config);
  checks.push(await writableCheck('state', state.root));

  for (const [label, specifier] of [
    ['adapter:pdf', 'unpdf'],
    ['adapter:docx', 'mammoth'],
    ['adapter:html', 'node-html-parser'],
  ] as const) {
    try {
      await import(specifier);
      checks.push({ name: label, status: 'ok', detail: `${specifier} loads` });
    } catch (cause) {
      checks.push({
        name: label,
        status: 'fail',
        detail: `${specifier} cannot be imported: ${(cause as Error).message}`,
        hint: 'Reinstall dependencies with `npm install`.',
      });
    }
  }

  checks.push({
    name: 'okf-spec-pin',
    status: OKF_SPEC_PIN.commit ? 'ok' : 'warn',
    detail: OKF_SPEC_PIN.commit
      ? `pinned to ${OKF_SPEC_PIN.commit.slice(0, 12)}`
      : `targeting OKF ${OKF_SPEC_PIN.version} from ${OKF_SPEC_PIN.repository}/${OKF_SPEC_PIN.path}, revision not pinned`,
    ...(OKF_SPEC_PIN.commit ? {} : { hint: 'Pin a commit in src/okf/types.ts once the upstream revision is chosen.' }),
  });

  checks.push(runtimeIdentity());
  checks.push(mcpDiscovery(config));

  const pluginPath = pluginRoot();
  checks.push(
    (await exists(pluginPath))
      ? { name: 'plugin', status: 'ok', detail: `${(await readdir(pluginPath)).join(', ')}` }
      : { name: 'plugin', status: 'warn', detail: `no plugin directory at ${pluginPath}` },
  );

  const report: DoctorReport = {
    checks,
    support: supportMatrix(config),
    context: await measureContext(pluginPath),
    ok: !checks.some((c) => c.status === 'fail'),
  };
  return report;
}

async function writableCheck(name: string, path: string): Promise<Check> {
  try {
    await access(path, constants.W_OK);
    return { name, status: 'ok', detail: `${path} is writable` };
  } catch {
    return {
      name,
      status: 'warn',
      detail: `${path} is not writable yet`,
      hint: 'It is created on first use; this is expected before `okb setup`.',
    };
  }
}

/**
 * Report the runtime honestly rather than guessing. Claude Code exposes very
 * little about itself to a child process, so "unknown" is a legitimate answer.
 */
function runtimeIdentity(): Check {
  const env = process.env;
  const signals = [
    env.CLAUDECODE ? 'CLAUDECODE' : null,
    env.CLAUDE_CODE_ENTRYPOINT ? `entrypoint=${env.CLAUDE_CODE_ENTRYPOINT}` : null,
    env.ANTHROPIC_MODEL ? `model=${env.ANTHROPIC_MODEL}` : null,
    env.ANTHROPIC_BASE_URL ? `proxy=${safeHost(env.ANTHROPIC_BASE_URL)}` : null,
    env.CLAUDE_CODE_USE_BEDROCK === '1' ? 'provider=bedrock' : null,
    env.CLAUDE_CODE_USE_VERTEX === '1' ? 'provider=vertex' : null,
  ].filter(Boolean);

  return signals.length > 0
    ? { name: 'runtime', status: 'ok', detail: signals.join(', ') }
    : {
        name: 'runtime',
        status: 'unknown',
        detail: 'no Claude Code environment signal visible from this process',
        hint: 'Version and provider are not exposed to child processes; run `claude --version` yourself to confirm.',
      };
}

function mcpDiscovery(config: OkbConfig): Check {
  if (config.connectors.mcp.length === 0) {
    return {
      name: 'mcp',
      status: 'ok',
      detail: 'no MCP connector configured; procedures run as local skills and scripts',
    };
  }
  return {
    name: 'mcp',
    status: 'unknown',
    detail: `configured: ${config.connectors.mcp.join(', ')}`,
    hint: 'Whether the host exposes on-demand MCP discovery cannot be detected from here; verify with `claude mcp list`.',
  };
}

function safeHost(value: string): string { try { return new URL(value).host; } catch { return 'invalid-url'; } }
