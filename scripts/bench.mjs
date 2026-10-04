#!/usr/bin/env node
/**
 * Cost and quality bench: runs a real OKB workflow through Claude Code, in a
 * sandbox, on a fictitious source with known facts, then grades the proposal.
 * It spends real tokens (your Claude account), so it is never part of
 * release:check. Nothing is approved and no real KB is touched.
 *
 *   node scripts/bench.mjs run   --out <dir> [--model opus] [--agents-model sonnet] [--effort high] [--case atelier-lyon-gerland] [--budget 8]
 *   node scripts/bench.mjs grade --out <dir>
 *   node scripts/bench.mjs judge --a <dir> --b <dir> [--model opus]
 *   node scripts/bench.mjs table <dir>…
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BENCH = join(ROOT, 'tests', 'bench');

const args = process.argv.slice(2);
const command = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

function okb(out, cliArgs, input) {
  const env = { ...process.env, OKB_HOME: join(out, 'home'), NO_COLOR: '1' };
  const r = spawnSync(process.execPath, [join(DIST, 'cli', 'index.js'), ...cliArgs], { env, encoding: 'utf8', input });
  if (r.status !== 0) throw new Error(`okb ${cliArgs.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

async function run() {
  const out = resolve(opt('out'));
  const caseId = opt('case', 'atelier-lyon-gerland');
  const spec = JSON.parse(readFileSync(join(BENCH, `${caseId}.expect.json`), 'utf8'));
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'work'), { recursive: true });

  // A fresh KB (seeded with the fictitious Acme bundle for a source), and its own OKB home.
  if (spec.repo) mkdirSync(join(out, 'kb'), { recursive: true });
  else cpSync(join(ROOT, 'tests', 'fixtures', 'vault-acme'), join(out, 'kb'), { recursive: true });
  okb(out, ['setup', '--profile', 'bench', '--kb-root', join(out, 'kb'), '--concept-assist', 'targeted', '--answer-language', 'fr', '--locale', 'fr-FR', '--json']);
  okb(out, ['settings', 'set', 'writing.language=fr', '--json']);
  let source = '';
  let cwd = join(out, 'work');
  if (spec.source) {
    source = join(out, 'work', `${caseId}.vtt`);
    cpSync(join(BENCH, spec.source), source);
  }
  if (spec.repo) {
    // The fictitious repository, as a Git repository of its own.
    cwd = join(out, 'work', 'repo');
    cpSync(join(BENCH, spec.repo), cwd, { recursive: true });
    const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Dana', GIT_AUTHOR_EMAIL: 'dana@example.com', GIT_COMMITTER_NAME: 'Dana', GIT_COMMITTER_EMAIL: 'dana@example.com' } });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'Orders service');
  }

  // The plugin from this checkout; subagents optionally pinned to another model.
  cpSync(join(ROOT, 'plugin'), join(out, 'plugin'), { recursive: true });
  const agentsModel = opt('agents-model');
  if (agentsModel) {
    for (const f of readdirSync(join(out, 'plugin', 'agents'))) {
      const p = join(out, 'plugin', 'agents', f);
      writeFileSync(p, readFileSync(p, 'utf8').replace(/^model: .*$/m, `model: ${agentsModel}`));
    }
  }
  // `okb` on PATH runs this checkout's build, against the sandbox home.
  mkdirSync(join(out, 'bin'), { recursive: true });
  writeFileSync(join(out, 'bin', 'okb'), `#!/bin/sh\nexec "${process.execPath}" "${join(DIST, 'cli', 'index.js')}" "$@"\n`);
  chmodSync(join(out, 'bin', 'okb'), 0o755);

  const model = opt('model', 'opus');
  const prompt = spec.prompt.replace('{source}', source).replace('{repo}', cwd);
  const claudeArgs = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    '--plugin-dir', join(out, 'plugin'),
    '--setting-sources', 'project,local',
    '--add-dir', out,
    '--allowedTools', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'Skill', 'Agent', 'Task', 'Bash(okb:*)', 'Bash(okb *)',
    '--max-budget-usd', opt('budget', '8'),
  ];
  if (opt('effort')) claudeArgs.push('--effort', opt('effort'));
  const env = { ...process.env, OKB_HOME: join(out, 'home'), PATH: `${join(out, 'bin')}:${process.env.PATH}` };
  const started = Date.now();
  const result = await new Promise((done) => {
    const child = spawn('claude', claudeArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
  writeFileSync(join(out, 'claude-result.json'), result.stdout || '{}');
  if (result.stderr) writeFileSync(join(out, 'claude-stderr.txt'), result.stderr);
  const meta = { case: caseId, model, agentsModel: agentsModel ?? 'inherit', effort: opt('effort') ?? 'default', exit: result.code, wallSeconds: Math.round((Date.now() - started) / 1000) };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta));
  await grade(out);
}

/** The text a proposal adds to the KB: new files in full, added lines of updated ones. */
async function proposedText(out) {
  const { loadConfig } = await import(join(DIST, 'config', 'load.js'));
  const { listProposals } = await import(join(DIST, 'proposal', 'store.js'));
  const { groupChangesByPath, materializeFile } = await import(join(DIST, 'proposal', 'materialize.js'));
  const eff = await loadConfig({ profileId: 'bench', env: { ...process.env, OKB_HOME: join(out, 'home') } });
  const config = eff.config ?? eff;
  const proposals = (await listProposals(config)).filter((p) => p.status !== 'superseded');
  const files = [];
  for (const p of proposals) {
    for (const [path, changes] of groupChangesByPath(p.changes)) {
      const abs = join(config.kb.root, path);
      const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
      const after = materializeFile(path, before, changes);
      const old = new Set((before ?? '').split('\n'));
      const added = after.split('\n').filter((l) => !old.has(l)).join('\n');
      files.push({ proposal: p.id, path, created: before === null, added, after });
    }
  }
  return { proposals, files };
}

const norm = (s) => s.replace(/ | /g, ' ');

async function grade(out) {
  const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'));
  const spec = JSON.parse(readFileSync(join(BENCH, `${meta.case}.expect.json`), 'utf8'));
  const { proposals, files } = await proposedText(out);
  const text = norm(files.map((f) => f.added).join('\n'));
  // Prose only: verbatim quotes may repeat what the source got wrong.
  const prose = text.split('\n').filter((l) => !l.trim().startsWith('>')).join('\n');
  const sentences = prose.split(/(?<=[.!?])\s+|\n+/);
  const facts = spec.facts.map((f) => {
    const missing = f.all.filter((re) => !new RegExp(re, 'iu').test(text));
    return { id: f.id, label: f.label, ok: missing.length === 0, missing };
  });
  const violations = spec.forbidden.flatMap((f) => {
    const hits = sentences.filter((s) => f.sentence.every((re) => new RegExp(re, 'u').test(s) || new RegExp(re, 'iu').test(s))
      && f.with.every((re) => new RegExp(re, 'iu').test(s))
      && !f.unless.some((re) => new RegExp(re, 'iu').test(s)));
    return hits.length ? [{ id: f.id, label: f.label, examples: hits.slice(0, 2) }] : [];
  });
  const result = JSON.parse(readFileSync(join(out, 'claude-result.json'), 'utf8') || '{}');
  // Same reading of the session log as `okb usage`.
  const usage = await sessionUsage(out, result.session_id);
  const words = prose.split(/\s+/).filter(Boolean).length;
  const report = {
    ...meta,
    costUsdClaude: result.total_cost_usd ?? null,
    turns: result.num_turns ?? null,
    durationSeconds: result.duration_ms ? Math.round(result.duration_ms / 1000) : null,
    modelUsage: result.modelUsage ?? null,
    usage,
    proposals: proposals.length,
    files: files.map((f) => ({ path: f.path, created: f.created, words: f.added.split(/\s+/).filter(Boolean).length })),
    concepts: files.filter((f) => f.created && f.path.startsWith('concepts/')).length,
    evidence: proposals.reduce((n, p) => n + p.evidence.length, 0),
    words,
    factsFound: facts.filter((f) => f.ok).length,
    factsTotal: facts.length,
    facts,
    violations,
  };
  writeFileSync(join(out, 'grade.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'proposed.md'), files.map((f) => `<!-- ${f.path}${f.created ? ' (new)' : ''} -->\n${f.after}`).join('\n\n---\n\n'));
  console.log(JSON.stringify({ out, cost: report.costUsdClaude, facts: `${report.factsFound}/${report.factsTotal}`, violations: violations.map((v) => v.id), proposals: report.proposals, words }));
}

async function sessionUsage(out, sessionId) {
  if (!sessionId) return null;
  const { claudeProjectsDir, listSessions, summariseSession } = await import(join(DIST, 'usage', 'claude-logs.js'));
  const entry = (await listSessions(claudeProjectsDir())).find((s) => s.session === sessionId);
  if (!entry) return null;
  const s = await summariseSession(entry, () => 'bench');
  const sum = (u) => Object.entries(u).map(([model, x]) => ({ model, costUsd: Math.round(x.costUsd * 1e4) / 1e4, tokens: x.tokens, requests: x.requests }));
  return {
    runs: s.okbRuns.map((r) => ({ workflow: r.workflow, main: sum(r.main), agents: r.agents.map((a) => ({ type: a.type, usage: sum(a.usage) })), okbCalls: r.okbCalls, okbErrors: r.okbErrors, outputBytes: r.outputBytes, skillBytes: r.skillBytes })),
    hookBytes: s.hookBytes,
  };
}

/** Blind pairwise judgement of the writing, both orders, by a model without tools. */
async function judge() {
  const a = resolve(opt('a'));
  const b = resolve(opt('b'));
  const spec = JSON.parse(readFileSync(join(BENCH, `${JSON.parse(readFileSync(join(a, 'meta.json'), 'utf8')).case}.expect.json`), 'utf8'));
  const source = spec.source
    ? readFileSync(join(BENCH, spec.source), 'utf8')
    : readdirSync(join(BENCH, spec.repo), { recursive: true }).filter((f) => !String(f).includes('.edmx') && !String(f).startsWith('.git/')).map((f) => { try { return `--- ${f}\n${readFileSync(join(BENCH, spec.repo, String(f)), 'utf8')}`; } catch { return ''; } }).join('\n');
  const textA = readFileSync(join(a, 'proposed.md'), 'utf8');
  const textB = readFileSync(join(b, 'proposed.md'), 'utf8');
  const ask = (first, second) => `Tu évalues deux propositions de notes de base de connaissances, écrites à partir de la même source (transcription de réunion ou code d'un repo), pour un lecteur débutant francophone. Juge uniquement la qualité de rédaction et l'exactitude par rapport à la source. Ignore la longueur en elle-même.

Critères : exactitude (aucune erreur, corrections tardives respectées, rien d'inventé), complétude utile, clarté pour un débutant, structure et facilité de relecture, citations pertinentes.

Réponds UNIQUEMENT par un objet JSON : {"exactitude":"1"|"2"|"=","completude":"1"|"2"|"=","clarte":"1"|"2"|"=","structure":"1"|"2"|"=","global":"1"|"2"|"=","raison":"<deux phrases>"}

<source>
${source}
</source>

<proposition_1>
${first}
</proposition_1>

<proposition_2>
${second}
</proposition_2>`;
  const once = (prompt) => {
    const r = spawnSync('claude', ['-p', prompt, '--model', opt('model', 'opus'), '--output-format', 'json', '--setting-sources', 'project,local', '--tools', ''], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: homedir() });
    const res = JSON.parse(r.stdout || '{}');
    const m = /\{[\s\S]*\}/.exec(res.result ?? '');
    return { verdict: m ? JSON.parse(m[0]) : null, costUsd: res.total_cost_usd ?? null };
  };
  const ab = once(ask(textA, textB));
  const ba = once(ask(textB, textA));
  const flip = (v) => (v === '1' ? '2' : v === '2' ? '1' : v);
  const keys = ['exactitude', 'completude', 'clarte', 'structure', 'global'];
  const verdict = Object.fromEntries(keys.map((k) => {
    const x = ab.verdict?.[k];
    const y = flip(ba.verdict?.[k]);
    const name = (v) => (v === '1' ? 'A' : v === '2' ? 'B' : '=');
    return [k, x === y ? name(x) : 'partagé'];
  }));
  const report = { a, b, verdict, reasons: [ab.verdict?.raison, ba.verdict?.raison], costUsd: (ab.costUsd ?? 0) + (ba.costUsd ?? 0) };
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(join(b, `judge-vs-${a.split('/').pop()}.json`), JSON.stringify(report, null, 2));
}

function table() {
  const dirs = args.slice(1);
  for (const d of dirs) {
    const g = JSON.parse(readFileSync(join(d, 'grade.json'), 'utf8'));
    const agents = (g.usage?.runs ?? []).flatMap((r) => r.agents).reduce((s, a) => s + a.usage.reduce((x, u) => x + u.costUsd, 0), 0);
    console.log([d.split('/').pop(), g.model, g.agentsModel, g.effort, `$${g.costUsdClaude?.toFixed(2)}`, `agents $${agents.toFixed(2)}`, `${g.durationSeconds}s`, `faits ${g.factsFound}/${g.factsTotal}`, `erreurs ${g.violations.length}`, `${g.words} mots`, `${g.concepts} concepts`, `${g.proposals} prop.`].join(' | '));
  }
}

if (command === 'run') await run();
else if (command === 'grade') await grade(resolve(opt('out')));
else if (command === 'judge') await judge();
else if (command === 'table') table();
else { console.error('usage: bench.mjs run|grade|judge|table'); process.exitCode = 2; }
