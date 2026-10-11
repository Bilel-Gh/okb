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
  { name: 'start', group: 'start', aliases: ['demarrer', 'démarrer', 'commencer'], usage: 'okb start [--cwd <dossier>]', examples: ['okb start', 'cd ~/dev/mon-equipe && okb start'], flags: ['--cwd'] },
  { name: 'init', group: 'start', usage: 'okb init', examples: ['okb init', 'okb init --yes --name Notes --dir ~/Notes/kb-notes', 'okb init --yes --name Travail --kind workspace --workspace ~/dev/acme'], flags: ['--yes', '--name', '--dir', '--lang', '--writing-lang', '--kind', '--repo', '--workspace', '--in-repo'] },
  { name: 'new', group: 'start', usage: 'okb new', examples: ['okb new'] },
  { name: 'tour', group: 'start', aliases: ['demo'], usage: 'okb tour', examples: ['okb tour'] },
  { name: 'status', group: 'daily', aliases: ['st'], usage: 'okb status [--brief]', examples: ['okb status', 'okb status --kb atlas'], flags: ['--brief'] },
  { name: 'find', group: 'daily', aliases: ['search', 'cherche', 'chercher', 'trouve'], usage: 'okb find "<mots>" [--product P] [--repo R] [--type T] | --file <chemin> | --error "<message>" | --gaps', examples: ['okb find odata', 'okb find "export csv" --repo atlas-api', 'okb find --file src/billing/tax.ts', 'okb find --error "TypeError: x is undefined"', 'okb find --gaps'], flags: ['--drawer', '--product', '--repo', '--type', '--status', '--limit', '--file', '--error', '--gaps'] },
  { name: 'ask', group: 'daily', aliases: [], usage: 'okb ask "<question>"', examples: ['okb ask "idempotence"', 'okb ask "comment vider l’inbox" --kb ia'] },
  { name: 'open', group: 'daily', usage: 'okb open [note | words]', examples: ['okb open', 'okb open concepts/eaf.md', 'okb open finance'] },
  { name: 'capture', group: 'daily', aliases: ['note'], usage: 'okb capture "<text>"', examples: ['okb capture "Relire le contrat Orion"', 'okb capture --from-file idee.md'] },
  { name: 'inbox', group: 'daily', usage: 'okb inbox [list|show|done|drop]', subcommands: ['list', 'show', 'done', 'drop'], examples: ['okb inbox', 'okb inbox list --all'] },
  { name: 'review', group: 'daily', usage: 'okb review [n | id]', examples: ['okb review', 'okb review 1', 'okb review --list --all'], flags: ['--list', '--all', '--diff', '--approve', '--only', '--discard'] },
  { name: 'undo', group: 'daily', usage: 'okb undo [--list]', examples: ['okb undo', 'okb undo --list'], flags: ['--list', '--yes'] },
  { name: 'focus', group: 'daily', usage: 'okb focus [init|set]', subcommands: ['show', 'init', 'set'], examples: ['okb focus', 'okb focus set "Sprint Orion : budgets"'] },
  { name: 'done', group: 'daily', usage: 'okb done --summary "…" [--keep "…"] [--next "…"]', examples: ['okb done', 'okb done --summary "Atelier budgets" --next "Relire la fiche idempotence"'] },
  { name: 'weekly', group: 'daily', usage: 'okb weekly [--days 7]', examples: ['okb weekly'] },
  { name: 'repo', group: 'daily', aliases: ['repos'], usage: 'okb repo [add|scan|status|level|exam|questions|answer|update|ticket|landscape]', subcommands: ['list', 'add', 'scan', 'status', 'level', 'exam', 'plan', 'findings', 'template', 'write', 'questions', 'answer', 'interview', 'update', 'ticket', 'landscape', 'context', 'remove'], examples: ['okb workspace add ~/dev/acme', 'cd ~/work/orders-service && okb repo add', 'okb repo status', 'okb repo level', 'okb repo exam atlas-api', 'okb repo questions', 'okb repo ticket --base main'], flags: ['--all', '--kb', '--new-kb', '--new-repo-kb', '--in-repo', '--to-kb', '--repo', '--base', '--title', '--ticket', '--by', '--propose', '--open', '--area', '--note', '--suggestion', '--quality', '--estimate', '--yes', '--last', '--only', '--add', '--expect', '--remove'] },
  { name: 'workspace', group: 'daily', aliases: ['ws', 'espace', 'workspaces'], usage: 'okb workspace [add <folder>|set|attach <repo>|detach <repo>|remove]', subcommands: ['list', 'add', 'set', 'attach', 'detach', 'remove'], examples: ['okb workspace add ~/dev/acme', 'okb workspace', 'okb workspace set acme --prefixes ABC,OPS', 'okb workspace attach billing-service --to acme'], flags: ['--kb', '--new-kb', '--name', '--to', '--prefixes', '--pattern', '--no-scan', '--no-landscape'] },
  { name: 'scope', group: 'daily', aliases: ['perimetre', 'périmètre', 'here'], usage: 'okb scope [<repo>|<ABC-123>|off]', examples: ['okb scope', 'okb scope orders-service', 'okb scope ABC-123', 'okb scope off'], flags: ['--cwd', '--context'] },
  { name: 'ticket', group: 'daily', aliases: ['tickets'], usage: 'okb ticket [start <ABC-123>|note "…"|done|list]', subcommands: ['status', 'start', 'note', 'done', 'list'], examples: ['okb ticket start ABC-123 --repo orders-service', 'okb ticket note "le total se recalcule côté serveur" --kind decision', 'okb ticket', 'okb ticket done'], flags: ['--repo', '--title', '--ticket-file', '--text', '--base', '--kind', '--ticket', '--all', '--keep-open'] },
  { name: 'now', group: 'daily', aliases: ['maintenant'], usage: 'okb now [objective "…" | wait "…" --who <équipe> | answered <id>]', subcommands: ['objective', 'wait', 'answered'], examples: ['okb now', 'okb now objective "Maîtriser le produit Atlas"', 'okb now wait "Quel quota pour l’API ?" --who "équipe plateforme"'], flags: ['--who'] },
  { name: 'brain', group: 'daily', aliases: ['cerveau'], usage: 'okb brain [status|where|types|index|context|glossary|migrate|check|repair|demo|views]', subcommands: ['status', 'where', 'types', 'index', 'context', 'glossary', 'migrate', 'check', 'repair', 'demo', 'views'], examples: ['okb brain', 'okb brain where ticket --product Atlas --repo atlas-api --ref ABC-123 --title "Export CSV"', 'okb brain context "2 Produits/Atlas"', 'okb brain migrate --preset topics', 'okb brain check'], flags: ['--preset', '--names', '--build', '--finish', '--plan-file', '--budget', '--connect', '--title', '--product', '--repo', '--theme', '--ref', '--date', '--level'] },
  { name: 'where', group: 'daily', aliases: ['ou', 'où'], usage: 'okb where <type> [--title "…"] [--product P] [--repo R] [--theme T] [--ref ABC-123]', examples: ['okb where concept --title OData', 'okb where meeting --title "Point d’équipe"'], flags: ['--title', '--product', '--repo', '--theme', '--ref', '--date', '--level'] },
  { name: 'product', group: 'daily', aliases: ['produit', 'produits', 'products'], usage: 'okb product [list | show <product> | set <repo> <product>]', subcommands: ['list', 'show', 'set'], examples: ['okb product', 'okb product show Atlas', 'okb product set atlas-api Atlas'] },
  { name: 'learn', group: 'daily', aliases: ['réviser', 'reviser', 'apprendre'], usage: 'okb learn [due | grade <card> again|hard|good|easy | map | quiz --repo R | goal add "<text>"]', subcommands: ['status', 'due', 'grade', 'map', 'quiz', 'goal'], examples: ['okb learn', 'okb learn grade c-1a2b3c good', 'okb learn map', 'okb learn quiz --repo atlas-api --json', 'okb learn goal add "Comprendre OData" --by 2026-12-01'], flags: ['--limit', '--subject', '--note', '--repo', '--product', '--by'] },
  { name: 'journal', group: 'daily', aliases: ['hier', 'yesterday'], usage: 'okb journal [--days N]', examples: ['okb journal --days 2', 'okb journal --days 7 --json'], flags: ['--days'] },
  { name: 'pack', group: 'advanced', aliases: ['packs', 'partager', 'share'], usage: 'okb pack export <folder> [--out file] | compare <file> --into <folder> | merge <file> --into <folder>', subcommands: ['export', 'compare', 'merge'], examples: ['okb pack export "2 Produits/Atlas/Code/atlas-api" --out atlas-api.okbpack.json', 'okb pack compare atlas-api.okbpack.json --into "2 Produits/Atlas/Code/atlas-api"', 'okb pack merge atlas-api.okbpack.json --into "2 Produits/Atlas/Code/atlas-api"'], flags: ['--out', '--into'] },
  { name: 'arch', group: 'daily', aliases: ['architecture', 'archi'], usage: 'okb arch [containers|context|flow] [<repo> "<call>"] [--mermaid] [--anyway]', subcommands: ['containers', 'context', 'flow'], examples: ['okb arch', 'okb arch flow', 'okb arch flow shop-web "POST /orders"', 'okb arch context --mermaid'], flags: ['--mermaid', '--anyway', '--kb'] },
  { name: 'progress', group: 'daily', aliases: ['progression', 'xp', 'badges'], usage: 'okb progress', examples: ['okb progress', 'okb progress --json'] },
  { name: 'translate', group: 'daily', aliases: ['traduire', 'traduction'], usage: 'okb translate <note> --to <lang> [--full] [--estimate] [--save]', examples: ['okb translate "Livrer une version" --to en', 'okb translate "Livrer une version" --to en --full', 'okb translate "Livrer une version" --to en --estimate', 'okb translate "Livrer une version" --to en --save'], flags: ['--to', '--full', '--estimate', '--save', '--confirm-secret'] },
  { name: 'whoami', group: 'advanced', aliases: ['moi', 'identite', 'identity'], usage: 'okb whoami', examples: ['okb whoami', 'okb settings set person.role dev'] },
  { name: 'today', group: 'daily', aliases: ['aujourdhui', 'aujourd’hui', 'jour'], usage: 'okb today', examples: ['okb today', 'okb today --json'] },
  { name: 'project', group: 'daily', aliases: ['projet', 'projets', 'projects'], usage: 'okb project [list | new "<title>" | show <project> | set <project> --where "…" --next "…" --status done | leave <project>]', subcommands: ['list', 'new', 'show', 'set', 'leave'], examples: ['okb project', 'okb project new "Sortie de juin"', 'okb project set ABC-231 --where "La pagination marche" --next "Finir les tests"', 'okb project leave ABC-231'], flags: ['--where', '--next', '--status', '--title', '--all', '--done', '--tried', '--waiting', '--resume'] },
  { name: 'action', group: 'daily', aliases: ['actions', 'todo'], usage: 'okb action [list | add "<text>" | done <id> | drop <id>]', subcommands: ['list', 'add', 'done', 'drop', 'reopen'], examples: ['okb action add "réserver le car avant le 15 mai" --project "Sortie de juin"', 'okb action', 'okb action done A-1a2b3c'], flags: ['--project', '--due', '--who', '--kind', '--all'] },
  { name: 'indicators', group: 'care', aliases: ['indicateurs'], usage: 'okb indicators', examples: ['okb indicators'] },
  { name: 'baggage', group: 'daily', aliases: ['bagage'], usage: 'okb baggage draft <note> | okb baggage keep <note> [--file <reread.md>] [--title "<title>"]', subcommands: ['draft', 'keep'], examples: ['okb baggage draft "3 Boîte à outils/Méthodes/Enquêter sur une lenteur.md"', 'okb baggage keep "3 Boîte à outils/Méthodes/Enquêter sur une lenteur.md"'], flags: ['--file', '--title'] },
  { name: 'doc', group: 'daily', aliases: ['docs', 'document', 'documents'], usage: 'okb doc [list | add <file> | find <words>]', subcommands: ['list', 'add', 'find'], examples: ['okb doc add ~/Downloads/devis.pdf --project "Sortie de juin"', 'okb doc find devis transporteur', 'okb doc'], flags: ['--project', '--title'] },
  { name: 'mcp', group: 'advanced', usage: 'okb mcp [--kb <id>]', examples: ['claude mcp add okb -- okb mcp'], flags: ['--kb'] },
  { name: 'modules', group: 'advanced', aliases: ['module', 'modules'], usage: 'okb modules [on|off|install <id>]', subcommands: ['on', 'off', 'install'], examples: ['okb modules', 'okb modules off dev', 'okb modules install dev'] },
  { name: 'metrics', group: 'advanced', aliases: ['mesures', 'beta'], usage: 'okb metrics [--days N]', examples: ['okb metrics', 'okb metrics --days 14 --json'], flags: ['--days', '--sample'] },
  { name: 'secret', group: 'advanced', aliases: ['confidentiel', 'confidential', 'lock'], usage: 'okb secret [list | set <note> secret|private|normal]', subcommands: ['list', 'set'], examples: ['okb secret', 'okb secret set "4 Activité/Carrière/Retours/2026-10-01 Retour.md" secret'] },
  { name: 'career', group: 'daily', aliases: ['carriere', 'carrière'], usage: 'okb career [status | prep one-on-one|annual [--since D] | check [--words a,b] | export <new folder>]', subcommands: ['status', 'prep', 'check', 'export'], examples: ['okb career', 'okb career prep one-on-one --json', 'okb career check --words "Projet X"'], flags: ['--since', '--words', '--to'] },
  { name: 'dev', group: 'daily', usage: 'okb dev review [--base B | --files a,b] | ship [--base B]', subcommands: ['review', 'ship'], examples: ['okb dev review --json', 'okb dev ship --json'], flags: ['--base', '--files', '--repo', '--cwd'] },
  { name: 'suggest', group: 'daily', aliases: ['suggestion', 'suggestions', 'garder'], usage: 'okb suggest [add|list|show|accept|decline|later] …', subcommands: ['add', 'card', 'list', 'show', 'accept', 'decline', 'later', 'done'], examples: ['okb suggest list', 'okb suggest add --type concept --title OData --why "demandé en session" --signal asked', 'okb suggest accept S-1a2b3c'], flags: ['--type', '--title', '--why', '--signal', '--source', '--product', '--repo', '--theme', '--ref', '--scope', '--notes', '--over-budget'] },
  { name: 'scores', group: 'care', aliases: ['score', 'notes-faibles'], usage: 'okb scores [note] [--below 50]', examples: ['okb scores --below 50', 'okb scores "3 Boîte à outils/Concepts/OData.md"'], flags: ['--below', '--limit'] },
  { name: 'rate', group: 'daily', aliases: ['avis'], usage: 'okb rate <note> up|down', examples: ['okb rate "…/OData.md" up'] },
  { name: 'serve', group: 'daily', aliases: ['web', 'reader'], usage: 'okb serve [--port 4317] [--no-open]', examples: ['okb serve'] },
  { name: 'convert', group: 'care', aliases: ['convertir'], usage: 'okb convert [--kb <id>]', examples: ['okb kb add ~/notes/ancienne-kb', 'okb convert --kb archives'], flags: ['--kb', '--plan-file', '--limit', '--cursor'] },
  { name: 'kb', group: 'care', usage: 'okb kb [list|switch|add|remove|convert|merge|adopt]', subcommands: ['list', 'switch', 'add', 'remove', 'archive', 'convert', 'merge', 'adopt'], examples: ['okb kb', 'okb kb switch atlas', 'okb kb add ~/Documents/anciennes-notes --name Archives', 'okb kb convert', 'okb kb merge orders-service --into travail', 'okb kb remove atlas'], flags: ['--name', '--confidential', '--plan-file', '--into', '--retire', '--yes'] },
  { name: 'settings', group: 'care', aliases: ['config'], usage: 'okb settings [show|set key=value]', subcommands: ['show', 'set'], examples: ['okb settings', 'okb settings set writing.language=fr'] },
  { name: 'doctor', group: 'care', usage: 'okb doctor [--fix]', examples: ['okb doctor', 'okb doctor --fix'], flags: ['--fix', '--verbose'] },
  { name: 'maintain', group: 'care', aliases: ['health'], usage: 'okb maintain [--check-sources]', examples: ['okb maintain', 'okb maintain --check-sources'] },
  { name: 'skillify', group: 'care', usage: 'okb skillify [note] [--out dir]', examples: ['okb skillify', 'okb skillify procedures/deployer.md --out .claude/skills'] },
  { name: 'update', group: 'care', usage: 'okb update [--from okb-x.y.z.tgz]', examples: ['okb update', 'okb update --from ~/Downloads/okb-0.8.0.tgz'], flags: ['--from', '--yes'] },
  { name: 'explain', group: 'care', usage: 'okb explain <code>', examples: ['okb explain E_STALE', 'okb explain LINK_BROKEN_TARGET'] },
  { name: 'categories', group: 'care', aliases: ['categorie', 'catégories'], usage: 'okb categories [set <note> <category|auto>]', subcommands: ['set'], examples: ['okb categories', 'okb categories set brouillons/idees.md guide'] },
  { name: 'usage', group: 'care', aliases: ['utilisation', 'couts', 'coûts', 'stats'], usage: 'okb usage [--days 30]', examples: ['okb usage', 'okb usage --days 7'], flags: ['--days'] },
  { name: 'report', group: 'care', aliases: ['rapport'], usage: 'okb report [--days 30] [--out file.md] [--with-paths]', examples: ['okb report', 'okb report --days 7 --print'], flags: ['--days', '--out', '--with-paths', '--print'] },
  { name: 'feedback', group: 'care', aliases: ['retour', 'signaler'], usage: 'okb feedback "<problème ou idée>"', examples: ['okb feedback "le résumé a oublié la décision sur les relances"'] },
  { name: 'history', group: 'care', aliases: ['historique', 'versions'], usage: 'okb history <note> [--show N] [--restore N]', examples: ['okb history "3 Boîte à outils/Concepts/OData.md"'], flags: ['--show', '--restore'] },
  { name: 'trash', group: 'care', aliases: ['corbeille'], usage: 'okb trash [restore <note>]', subcommands: ['restore'], examples: ['okb trash', 'okb trash restore "…/OData.md"'], flags: ['--days'] },
  { name: 'backup', group: 'care', aliases: ['sauvegarde', 'sauvegardes', 'backups'], usage: 'okb backup [run|list|verify|drill|restore <date> --to <dossier> [--as <nom>]]', subcommands: ['run', 'list', 'verify', 'drill', 'restore'], examples: ['okb backup run', 'okb backup verify', 'okb backup restore 2026-10-01 --to ~/Restauration'], flags: ['--force', '--to'] },
  { name: 'glossary', group: 'care', aliases: ['glossaire'], usage: 'okb glossary [term]', examples: ['okb glossary', 'okb glossary reçu'] },
  { name: 'ingest', group: 'advanced', usage: 'okb ingest <source> --create <path> --analysis-file <dossier.json>', examples: ['okb ingest notes.vtt --extract-only'] },
  { name: 'apply', group: 'advanced', usage: 'okb apply <proposal> [--only a,b] [--rollback <receipt>]', examples: ['okb apply 1'] },
  { name: 'combine', group: 'advanced', usage: 'okb combine <proposal> <proposal>…', examples: [] },
  { name: 'nav', group: 'advanced', usage: 'okb nav [--after prepared]', examples: ['okb nav'] },
  { name: 'links', group: 'advanced', usage: 'okb links check | move <from> <to>', subcommands: ['check', 'move'], examples: ['okb links move guides/a.md guides/b.md'] },
  { name: 'revise', group: 'advanced', usage: 'okb revise <note.md> --file <revised.md>', examples: [] },
  { name: 'template', group: 'advanced', aliases: ['templates'], usage: 'okb template [list|show <id>]', subcommands: ['list', 'show'], examples: ['okb template list'] },
  { name: 'style', group: 'advanced', usage: 'okb style [presets | types] [--type <kind>] [--style technique|normal|simplifié] [--length courte|normale|détaillée] [--set knob=value]', examples: ['okb style', 'okb style --type concept', 'okb style types'] },
  { name: 'setup', group: 'advanced', usage: 'okb setup --profile <id> --kb-root <path> --concept-assist <level>', examples: [] },
  { name: 'concepts', group: 'advanced', usage: 'okb concepts list | check [--suggest] | detect <source>', subcommands: ['list', 'check', 'detect'], examples: ['okb concepts check', 'okb concepts check --suggest'], flags: ['--suggest'] },
  { name: 'migrate', group: 'advanced', usage: 'okb migrate 2.0 [--apply | --rollback] · okb migrate portable-links', examples: ['okb migrate 2.0', 'okb migrate 2.0 --apply'] },
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
