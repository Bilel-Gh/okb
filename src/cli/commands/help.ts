import { t } from '../../i18n/index.js';
import { listKbs } from '../../kb/registry.js';
import { paint } from '../ui/term.js';
import type { Ctx } from './common.js';

/**
 * The command catalogue: grouped by moment of use, each with a one-line
 * description and examples. It drives `okb help`, `okb help <command>`,
 * typo suggestions and shell completion, so they never disagree.
 */
export type CommandGroup = 'start' | 'daily' | 'care' | 'advanced';
export type CommandInfo = {
  readonly name: string;
  readonly group: CommandGroup;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly examples: readonly string[];
  readonly subcommands?: readonly string[];
  readonly flags?: readonly string[];
};

export const COMMANDS: readonly CommandInfo[] = [
  { name: 'init', group: 'start', usage: 'okb init', examples: ['okb init', 'okb init --yes --name Notes --dir ~/Notes/kb-notes'], flags: ['--yes', '--name', '--dir', '--lang', '--writing-lang'] },
  { name: 'new', group: 'start', usage: 'okb new', examples: ['okb new'] },
  { name: 'tour', group: 'start', aliases: ['demo'], usage: 'okb tour', examples: ['okb tour'] },
  { name: 'status', group: 'daily', aliases: ['st'], usage: 'okb status [--brief]', examples: ['okb status', 'okb status --kb argo'], flags: ['--brief'] },
  { name: 'ask', group: 'daily', aliases: ['search', 'find'], usage: 'okb ask "<question>"', examples: ['okb ask "EAF"', 'okb ask "comment vider l’inbox" --kb ia'] },
  { name: 'open', group: 'daily', usage: 'okb open [note | words]', examples: ['okb open', 'okb open concepts/eaf.md', 'okb open finance'] },
  { name: 'capture', group: 'daily', aliases: ['note'], usage: 'okb capture "<text>"', examples: ['okb capture "Relire le contrat Carina"', 'okb capture --from-file idee.md'] },
  { name: 'inbox', group: 'daily', usage: 'okb inbox [list|show|done|drop]', subcommands: ['list', 'show', 'done', 'drop'], examples: ['okb inbox', 'okb inbox list --all'] },
  { name: 'review', group: 'daily', usage: 'okb review [n | id]', examples: ['okb review', 'okb review 1', 'okb review --list --all'], flags: ['--list', '--all', '--diff', '--approve', '--only', '--discard'] },
  { name: 'undo', group: 'daily', usage: 'okb undo [--list]', examples: ['okb undo', 'okb undo --list'], flags: ['--list', '--yes'] },
  { name: 'focus', group: 'daily', usage: 'okb focus [init|set]', subcommands: ['show', 'init', 'set'], examples: ['okb focus', 'okb focus set "Sprint Carina : budgets"'] },
  { name: 'done', group: 'daily', usage: 'okb done --summary "…" [--keep "…"] [--next "…"]', examples: ['okb done', 'okb done --summary "Atelier budgets" --next "Relire la fiche EAF"'] },
  { name: 'weekly', group: 'daily', usage: 'okb weekly [--days 7]', examples: ['okb weekly'] },
  { name: 'serve', group: 'daily', aliases: ['web', 'reader'], usage: 'okb serve [--port 4317] [--no-open]', examples: ['okb serve'] },
  { name: 'kb', group: 'care', usage: 'okb kb [list|switch|archive|adopt]', subcommands: ['list', 'switch', 'archive', 'adopt'], examples: ['okb kb', 'okb kb switch argo'] },
  { name: 'settings', group: 'care', aliases: ['config'], usage: 'okb settings [show|set key=value]', subcommands: ['show', 'set'], examples: ['okb settings', 'okb settings set writing.language=fr'] },
  { name: 'doctor', group: 'care', usage: 'okb doctor [--fix]', examples: ['okb doctor', 'okb doctor --fix'], flags: ['--fix', '--verbose'] },
  { name: 'maintain', group: 'care', aliases: ['health'], usage: 'okb maintain [--check-sources]', examples: ['okb maintain', 'okb maintain --check-sources'] },
  { name: 'skillify', group: 'care', usage: 'okb skillify [note] [--out dir]', examples: ['okb skillify', 'okb skillify procedures/deployer.md --out .claude/skills'] },
  { name: 'update', group: 'care', usage: 'okb update', examples: ['okb update'] },
  { name: 'explain', group: 'care', usage: 'okb explain <code>', examples: ['okb explain E_STALE', 'okb explain LINK_BROKEN_TARGET'] },
  { name: 'glossary', group: 'care', aliases: ['glossaire'], usage: 'okb glossary [term]', examples: ['okb glossary', 'okb glossary reçu'] },
  { name: 'ingest', group: 'advanced', usage: 'okb ingest <source> --create <path> --analysis-file <dossier.json>', examples: ['okb ingest notes.vtt --extract-only'] },
  { name: 'apply', group: 'advanced', usage: 'okb apply <proposal> [--only a,b] [--rollback <receipt>]', examples: ['okb apply 1'] },
  { name: 'combine', group: 'advanced', usage: 'okb combine <proposal> <proposal>…', examples: [] },
  { name: 'nav', group: 'advanced', usage: 'okb nav [--after prepared]', examples: ['okb nav'] },
  { name: 'links', group: 'advanced', usage: 'okb links check | move <from> <to>', subcommands: ['check', 'move'], examples: ['okb links move guides/a.md guides/b.md'] },
  { name: 'revise', group: 'advanced', usage: 'okb revise <note.md> --file <revised.md>', examples: [] },
  { name: 'template', group: 'advanced', aliases: ['templates'], usage: 'okb template [list|show <id>]', subcommands: ['list', 'show'], examples: ['okb template list'] },
  { name: 'style', group: 'advanced', usage: 'okb style [presets] [--set knob=value]', examples: ['okb style'] },
  { name: 'setup', group: 'advanced', usage: 'okb setup --profile <id> --kb-root <path> --concept-assist <level>', examples: [] },
  { name: 'concepts', group: 'advanced', usage: 'okb concepts list | detect <source>', subcommands: ['list', 'detect'], examples: [] },
  { name: 'migrate', group: 'advanced', usage: 'okb migrate portable-links', examples: [] },
  { name: 'route', group: 'advanced', usage: 'okb route "<request>"', examples: ['okb route "on a fini pour aujourd’hui"'] },
  { name: 'context', group: 'advanced', usage: 'okb context', examples: [] },
  { name: 'profile', group: 'advanced', usage: 'okb profile', examples: [] },
  { name: 'completion', group: 'advanced', usage: 'okb completion zsh|bash', examples: ['okb completion zsh >> ~/.zshrc'] },
  { name: 'version', group: 'advanced', usage: 'okb version', examples: [] },
];

export function findCommand(name: string): CommandInfo | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length]![b.length]!;
}

/** "revew" → "review": the closest command names, if close enough. */
export function suggest(name: string): string[] {
  const all = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  return all.map((n) => ({ n, d: distance(name.toLowerCase(), n) })).filter((x) => x.d <= Math.max(2, Math.floor(name.length / 3))).sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.n);
}

export function cmdHelp(ctx: Ctx): number {
  const topic = ctx.args.positionals[0];
  if (topic) return commandHelp(ctx, topic);
  const all = Boolean(ctx.args.flags.all);
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, commands: COMMANDS }); return 0; }
  const { out } = ctx;
  out.line(`${paint.brand('◆')} ${paint.bold('OKB')} — ${t('help.tagline')}`);
  for (const group of ['start', 'daily', 'care', 'advanced'] as const) {
    if (group === 'advanced' && !all) continue;
    out.heading(t(`help.group.${group}`));
    for (const c of COMMANDS.filter((x) => x.group === group)) out.line(`  ${paint.code(`okb ${c.name}`.padEnd(16))} ${t(`help.cmd.${c.name}`)}`);
  }
  out.line();
  out.line(paint.dim(t('help.global')));
  if (!all) out.line(paint.dim(t('help.more')));
  out.line(paint.dim(t('help.claude')));
  return 0;
}

export function commandHelp(ctx: Ctx, name: string): number {
  const c = findCommand(name);
  if (!c) {
    const near = suggest(name);
    ctx.out.warn(t('help.unknown', { name }) + (near.length ? ` ${t('help.didYouMean', { names: near.map((n) => `okb ${n}`).join(', ') })}` : ''));
    return 64;
  }
  if (ctx.mode === 'json') { ctx.out.json({ ok: true, command: c, description: t(`help.cmd.${c.name}`) }); return 0; }
  ctx.out.line(`${paint.bold(`okb ${c.name}`)} — ${t(`help.cmd.${c.name}`)}`);
  ctx.out.line(`\n${paint.dim(t('help.usage'))} ${paint.code(c.usage)}`);
  if (c.aliases?.length) ctx.out.line(`${paint.dim(t('help.aliases'))} ${c.aliases.join(', ')}`);
  if (c.examples.length) {
    ctx.out.line(`\n${paint.dim(t('help.examples'))}`);
    for (const e of c.examples) ctx.out.line(`  ${paint.code(e)}`);
  }
  ctx.out.line(`\n${paint.dim(t('help.global'))}`);
  return 0;
}

/** `okb completion zsh|bash` — a completion script; `okb __complete` answers it with live KB names. */
export function cmdCompletion(ctx: Ctx): number {
  const shell = ctx.args.positionals[0] ?? (process.env.SHELL?.endsWith('bash') ? 'bash' : 'zsh');
  const names = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]).join(' ');
  if (shell === 'bash') {
    ctx.out.line(`# okb completion for bash — add to ~/.bashrc:  source <(okb completion bash)
_okb() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=( $(compgen -W "${names}" -- "$cur") ); return; fi
  COMPREPLY=( $(compgen -W "$(okb __complete "\${COMP_WORDS[@]:1}" 2>/dev/null)" -- "$cur") )
}
complete -F _okb okb`);
    return 0;
  }
  ctx.out.line(`#compdef okb
# okb completion for zsh — add to ~/.zshrc:  source <(okb completion zsh)
_okb() {
  if (( CURRENT == 2 )); then compadd -- ${names}; return; fi
  compadd -- \${(f)"$(okb __complete \${words[2,CURRENT-1]} 2>/dev/null)"}
}
compdef _okb okb`);
  return 0;
}

/** Candidates for the word being completed: subcommands, KB names after --kb, flags. */
export async function cmdComplete(ctx: Ctx): Promise<number> {
  const words = ctx.args.positionals;
  const c = findCommand(words[0] ?? '');
  const last = words[words.length - 1] ?? '';
  let out: string[] = [];
  if (last === '--kb' || last === '--profile' || (c?.name === 'kb' && words[1] === 'switch')) out = (await listKbs()).map((k) => k.id);
  else if (c) out = [...(c.subcommands ?? []), ...(c.flags ?? []), '--kb', '--json'];
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}
