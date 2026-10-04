import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureContext, pluginRoot } from '../src/doctor/doctor.js';
import { estimateTokens, paginate, truncationNotice } from '../src/util/context-meter.js';
import { walkFiles } from '../src/util/fsx.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const PACKAGE_ROOT = resolve(TEST_ROOT, '..');

/**
 * Anything that would betray the author's machine, employer or private corpus.
 * This file holds the patterns themselves, so it carries the okb-leak-fixture marker.
 */
const LEAKS: readonly { label: string; re: RegExp }[] = [
  { label: 'home directory', re: /\/Users\/[a-z0-9._-]+\//i },
  { label: 'windows home', re: /C:\\Users\\[a-z0-9._-]+/i },
  { label: 'linux home', re: /\/home\/[a-z0-9._-]+\//i },
  { label: 'github token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { label: 'slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'bearer header', re: /authorization:\s*bearer\s+\S+/i },
  { label: 'internal sap host', re: /\b[\w.-]*\.sap\.corp\b|\bgithub\.tools\.sap\b|\bwdf\.sap\.corp\b/i },
  { label: 'employer-specific vocabulary', re: /\b(SBPA|IRPA|SuccessFactors|SAPMLIPA|Joule)\b/ },
];

async function shippedFiles(): Promise<string[]> {
  const pkg = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    files: string[];
  };
  const out: string[] = [];
  for (const entry of [...pkg.files, 'src', 'scripts', 'examples', 'tests', 'package.json']) {
    const base = resolve(PACKAGE_ROOT, entry);
    try {
      const nested = await walkFiles(base);
      out.push(...nested.map((n) => `${entry}/${n}`));
    } catch {
      out.push(entry);
    }
  }
  return out.filter((f) => !f.startsWith('dist/'));
}

/**
 * A file may hold a synthetic secret or path on purpose — the redaction tests
 * need one. Such a file declares the marker below, and the test asserts the
 * exemption list stays exactly what it is, so an exemption cannot be added
 * quietly.
 */
const FIXTURE_MARKER = 'okb-leak-fixture';
const EXPECTED_EXEMPTIONS = [
  'tests/config.test.ts',
  'tests/links.test.ts',
  'tests/packaging.test.ts',
];

describe('shareable package', () => {
  it('contains nothing personal, no machine path and no employer vocabulary', async () => {
    const files = await shippedFiles();
    expect(files.length).toBeGreaterThan(10);

    const findings: string[] = [];
    const exempted: string[] = [];
    for (const rel of files) {
      if (/\.(png|jpg|jpeg|gif|pdf|docx|zip)$/i.test(rel)) continue;
      let text: string;
      try {
        text = await readFile(resolve(PACKAGE_ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(FIXTURE_MARKER)) {
        exempted.push(rel);
        continue;
      }
      for (const leak of LEAKS) {
        if (leak.re.test(text)) findings.push(`${rel}: ${leak.label}`);
      }
    }
    expect(findings).toEqual([]);
    expect(exempted.sort()).toEqual(EXPECTED_EXEMPTIONS);
  });

  it('ships the fictional corpus only', async () => {
    const fixtures = await walkFiles(resolve(TEST_ROOT, 'fixtures'));
    expect(fixtures.length).toBeGreaterThan(5);
    const joined = (
      await Promise.all(
        fixtures.map((f) => readFile(resolve(TEST_ROOT, 'fixtures', f), 'utf8').catch(() => '')),
      )
    ).join('\n');
    expect(joined).toContain('Acme Robotics');
    expect(joined).toMatch(/fictional|fixture/i);
  });

  it('declares its dependencies and its entry point', async () => {
    const pkg = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
      dependencies: Record<string, string>;
      engines: { node: string };
      files: string[];
    };
    expect(pkg.bin.okb).toBe('dist/cli/index.js');
    expect(pkg.engines.node).toMatch(/>=22/);
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@clack/prompts',
      'd3-force',
      'mammoth',
      'mermaid',
      'node-html-parser',
      'picocolors',
      'rehype-sanitize',
      'rehype-stringify',
      'remark-gfm',
      'remark-parse',
      'remark-rehype',
      'unified',
      'unist-util-visit',
      'unpdf',
      'yaml',
      'zod',
    ]);
    expect(pkg.files).toContain('plugin');
  });
});

describe('context footprint', () => {
  it('separates measured bytes from estimated tokens', async () => {
    const footprint = await measureContext(pluginRoot());
    expect(footprint.alwaysOn.bytes).toBeGreaterThan(0);
    expect(footprint.alwaysOn.kind).toBe('measured-bytes');
    expect(footprint.notes.join(' ')).toContain('estimated');
    expect(footprint.notes.join(' ')).toContain('no tokenizer is bundled');
  });

  it('keeps the always-on footprint small and loads procedures on demand', async () => {
    const footprint = await measureContext(pluginRoot());
    // Resident cost: plugin manifest + command and skill frontmatter only.
    expect(footprint.alwaysOn.tokensEstimated).toBeLessThan(2_500);

    const workflowTotal = footprint.perWorkflow.reduce((a, m) => a + m.tokensEstimated, 0);
    expect(workflowTotal).toBeGreaterThan(footprint.alwaysOn.tokensEstimated);

    // No single workflow blows the budget when it is loaded.
    for (const m of footprint.perWorkflow) expect(m.tokensEstimated).toBeLessThan(2_000);
    for (const m of footprint.perAgent) expect(m.tokensEstimated).toBeLessThan(1_500);
  });

  it('makes truncated output identifiable and resumable', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const first = paginate(items, { limit: 4 });
    expect(first.page).toEqual([0, 1, 2, 3]);
    expect(truncationNotice(first.truncation, 'okb maintain')).toContain('--cursor 4');

    const second = paginate(items, { limit: 4, cursor: first.truncation.nextCursor });
    expect(second.page).toEqual([4, 5, 6, 7]);

    const last = paginate(items, { limit: 4, cursor: second.truncation.nextCursor });
    expect(last.truncation.truncated).toBe(false);
    expect(truncationNotice(last.truncation, 'okb maintain')).toBeNull();
  });

  it('estimates tokens from bytes, not characters', () => {
    expect(estimateTokens('abcd')).toBe(Math.ceil(4 / 3.8));
    expect(estimateTokens('é')).toBe(1);
  });
});

describe('approval hook', () => {
  const hook = resolve(pluginRoot(), 'hooks', 'guard-approval.mjs');

  async function run(command: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(process.execPath, [hook], { stdio: ['pipe', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (c) => {
        out += String(c);
      });
      child.on('error', reject);
      child.on('close', () => resolvePromise(out));
      child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
    });
  }

  it('denies the approval command when it comes from a tool call', async () => {
    const out = await run('okb review abc123 --approve --only c-article');
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies an attempt to bypass review through the environment', async () => {
    const out = await run('OKB_APPLY_MODE=allow-direct okb apply abc123');
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies reading the approval key', async () => {
    const out = await run('cat ~/.okb/profiles/alpha/state/approval.key');
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('denies calling the web app approval endpoint or clicking its dialog from a script', async () => {
    for (const command of [
      "curl -s -X POST -H 'X-OKB-Token: t' http://127.0.0.1:4317/api/proposal/approve -d '{}'",
      "node -e \"fetch('http://localhost:4317/api/proposal/approve',{method:'POST'})\"",
      'osascript -e \'tell application "System Events" to click button "Approve" of window "OKB"\'',
    ]) expect(JSON.parse(await run(command)).hookSpecificOutput.permissionDecision, command).toBe('deny');
    expect(await run('curl -s http://127.0.0.1:4317/api/proposal?id=p-1')).toBe('');
  });

  it('lets the ordinary workflow through', async () => {
    for (const command of [
      'okb ingest notes.vtt --append flows/a.md --heading Notes --json',
      'okb review abc123 --diff --json',
      'okb apply abc123 --only c-article --json',
      'okb maintain --json',
    ]) {
      expect(await run(command)).toBe('');
    }
  });
});
