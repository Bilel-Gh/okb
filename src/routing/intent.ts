import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Natural language → an OKB command to offer. People do not learn commands by
 * heart: "ok fin de session", "lis ce transcript", "note ça" should lead to
 * /okb:done, /okb:ingest, /okb:capture. This only produces an OFFER that the
 * plugin hands to Claude, who asks the person first.
 *
 * Other knowledge tools come first. When the person also uses another knowledge
 * base or agent (a support agent's KB, a wiki, a notes MCP), OKB never claims a
 * request that names it, and for generic requests ("search the KB") Claude asks
 * which one is meant instead of assuming OKB.
 */
export type IntentId =
  | 'done' | 'ingest' | 'ask' | 'capture' | 'inbox' | 'focus' | 'weekly' | 'learn' | 'review'
  | 'undo' | 'maintain' | 'revise' | 'skillify' | 'setup' | 'switch' | 'status' | 'serve' | 'onboard' | 'ticket'
  | 'usage' | 'feedback';

type Rule = {
  readonly id: IntentId;
  readonly command: string;
  /** Words that only make sense for OKB: no other tool can be meant. */
  readonly okbOnly: boolean;
  readonly patterns: readonly RegExp[];
  readonly not?: readonly RegExp[];
};

const W = String.raw`(?:^|[\s,.;:!?«"'(])`;

export const INTENT_RULES: readonly Rule[] = [
  { id: 'onboard', command: '/okb:onboard', okbOnly: false, patterns: [
    /\b(je )?(d[ée]couvre|arrive sur|commence sur|d[ée]bute sur|reprends?)\b.{0,25}\b(ce |le |un |nouveau )?(repo|d[ée]p[ôo]t|projet|code ?base|composant|microservice|service)\b/i,
    /\b(onboarde?[-\s]?moi|onboarding)\b.{0,30}\b(repo|d[ée]p[ôo]t|projet|code|composant|service)\b/i,
    /\b(explique|pr[ée]sente|fais)[-\s]?(moi )?(le |ce |un )?(tour|fonctionnement|architecture)?\s*(de |du )?(ce |le )?(repo|d[ée]p[ôo]t|projet|code ?base|composant)\b/i,
    /\b(aide|aider)[-\s]?(moi )?[àa] (comprendre|d[ée]marrer sur|prendre en main) (ce |le |un )?(repo|d[ée]p[ôo]t|projet|code ?base|code|composant)\b/i,
    /\bi('| a)m (new to|joining|starting on|discovering) (this|the|a) (repo|repository|codebase|project|service)\b/i,
    /\b(onboard me|get me started|help me (understand|get started (on|with))) (on |with )?(this|the) (repo|repository|codebase|project)\b/i,
    /\b(explain|walk me through) (this|the) (repo|repository|codebase)\b/i,
  ], not: [/\b(cr[ée]e|initialise|clone)[-\s]?(moi )?(un |le )?(nouveau )?(repo|d[ée]p[ôo]t)\b/i, /\b(create|init|clone) (a |the )?(new )?(repo|repository)\b/i] },
  { id: 'ticket', command: '/okb:ticket', okbOnly: false, patterns: [
    /\b(j['’]ai|on a) (fini|termin[ée]|boucl[ée]|livr[ée]|merg[ée]) (le |mon |ce |la |ma )?(ticket|story|user story|bug|fix|feature|t[âa]che|issue|pr|pull request)\b/i,
    /\b(ticket|story|bug|feature|issue|pr) (fini|termin[ée]|boucl[ée]|livr[ée]|merg[ée])\b/i,
    /\b(ajoute|mets|enregistre|retiens)\b.{0,30}\b(dans |à )?(la )?kb (du|de ce) (repo|d[ée]p[ôo]t|projet)\b/i,
    /\bi('| ha)ve (finished|completed|closed|merged) (the |my |this )?(ticket|story|bug|fix|feature|issue|pr|pull request)\b/i,
    /\b(ticket|issue|story) (is )?(done|finished|merged)\b/i,
    /\b(update|add (this|it) to) the (repo|repository|codebase) (kb|knowledge base)\b/i,
  ] },
  { id: 'done', command: '/okb:done', okbOnly: true, patterns: [
    /(^|\s)\/done\b/i,
    /\bfin de (la )?session\b/i,
    /\bon a (fini|termin[ée])\b/i,
    /\b(c['’]est|ce sera) (tout|fini|bon) pour (aujourd['’]hui|ce soir|la journ[ée]e|cette session)\b/i,
    /\b(on|je) (s['’]arr[êe]te|m['’]arr[êe]te|arr[êe]te) (là|ici|pour (aujourd['’]hui|ce soir))/i,
    /\bwrap(ping)? (it )?up\b/i,
    /\b(end|close) (of )?(the |this )?(work )?session\b/i,
    /\b(that['’]s|that is) (it|all) for (today|now|tonight)\b/i,
    /\bdone for (today|the day|tonight)\b/i,
  ] },
  { id: 'ingest', command: '/okb:ingest', okbOnly: false, patterns: [
    /\b(lis|lire|importe[rz]?|int[èe]gre[rz]?|ing[èe]re[rz]?|analyse[rz]?|digère)\b.{0,40}\b(transcript|transcription|compte[-\s]?rendu|document|doc|fichier|article|page|lien|pdf|vid[ée]o|r[ée]union|cours|le[çc]on|notes? de r[ée]union)\b/i,
    /\b(ajoute|mets|range|enregistre)[-\s]?(le|la|les|ça|ceci|cela)?\s+(dans|à)\s+(ma|mon|mes|la)\s+(kb|base|notes|second cerveau)\b/i,
    /\b(read|import|ingest|digest|process)\b.{0,30}\b(this|the|that)\b.{0,20}\b(transcript|document|doc|file|article|page|link|pdf|meeting|recording)\b/i,
    /\badd (this|it|these|that)\b.{0,30}\b(to|into)\b.{0,15}\b(my )?(kb|knowledge base|notes|second brain)\b/i,
    /\.(vtt|docx|pdf)\b.{0,60}\b(kb|base|notes|importe|lis|read|import|ingest)\b/i,
  ], not: [/\b(juste|seulement|only|just)\s+(r[ée]sum|summar)/i, /\b(ne pas|sans|don['’]?t|do not)\s+(enregistrer|garder|save|store|add)/i] },
  { id: 'capture', command: '/okb:capture', okbOnly: false, patterns: [
    /\b(note|garde|retiens|capture|m[ée]morise)[-\s]?(ça|ceci|cela|cette id[ée]e|cette info|ce lien)\b/i,
    /\b(à|a) garder pour plus tard\b|\bpour plus tard\s*:/i,
    /\b(jot|note|save|keep|capture) (this|that|it) (down|for later)\b/i,
    /\bremember this for later\b|\bsave this idea\b/i,
    /\b(note|jot down|save) (this|that)\s*:/i,
  ], not: [/\bcapture d['’][ée]cran\b|\bscreenshot\b/i] },
  { id: 'inbox', command: '/okb:inbox', okbOnly: false, patterns: [
    /\b(trie[rz]?|vide[rz]?|range[rz]?|traite[rz]?)\b.{0,15}\b(mon |l['’]|ma )?inbox\b/i,
    /\b(sort|triage|clear|empty|process)\b.{0,15}\b(my )?inbox\b/i,
  ], not: [/\b(mail|e-?mail|gmail|outlook|courriel)\b/i] },
  { id: 'focus', command: '/okb:focus', okbOnly: true, patterns: [
    /\b(mon|ma|mes) (focus|priorit[ée]s du moment)\b|\bfocus du moment\b/i,
    /\b(mets?|met|mettre) à jour mon focus\b|\bchange(r)? (de|mon) focus\b/i,
    /\b(my|current) focus\b|\bupdate my focus\b|\bwhat i('| a)m (currently )?working on\b/i,
  ], not: [/\bfocus mode\b|\bmode focus\b/i] },
  { id: 'weekly', command: '/okb:weekly', okbOnly: true, patterns: [
    /\brevue (de la |de ma )?(semaine|hebdo(madaire)?)\b|\bweekly( review)?\b|\bpoint (de la|hebdo de la) semaine\b/i,
  ], not: [/\b(sprint|pull request|\bpr\b|r[ée]union d['’][ée]quipe|team)\b/i] },
  { id: 'learn', command: '/okb:learn', okbOnly: false, patterns: [
    /\b(interroge|teste|quizz?e?)[-\s]?(moi|me)\b/i,
    /\bfais[-\s]moi r[ée]viser\b|\bje veux r[ée]viser\b|\bquiz me\b|\btest me on\b|\bhelp me (revise|memori[sz]e)\b/i,
  ] },
  { id: 'review', command: '/okb:review', okbOnly: true, patterns: [
    /\b(montre|relis|ouvre|affiche)[-\s]?(moi )?(la |les )?(proposition|propositions)\b/i,
    /\bqu['’]est[-\s]ce qui (m['’])?attend\b|\bce qui attend ma relecture\b/i,
    /\b(show|review|open) (me )?(the |my )?(okb )?proposals?\b/i,
  ], not: [/\b(pull request|\bpr\b|merge request|code review)\b/i] },
  { id: 'undo', command: 'okb undo', okbOnly: false, patterns: [
    /\bannule[rz]? (le |la )?derni(er|ère) (changement|application|import)\b/i,
    /\breviens? en arri[èe]re sur (ma |la )?(kb|base|notes)\b/i,
    /\bundo the last (change|apply|import)\b/i,
  ] },
  { id: 'maintain', command: '/okb:maintain', okbOnly: false, patterns: [
    /\b(v[ée]rifie|audite|nettoie|contr[ôo]le)[-\s]?(ma|la|mes)\s+(kb|base|notes)\b/i,
    /\bliens? cass[ée]s\b|\bsant[ée] de (ma |la )?(kb|base)\b/i,
    /\b(check|audit|clean up) (my )?(kb|knowledge base|notes)\b|\bbroken links\b/i,
  ], not: [/\b(code|repo|d[ée]p[ôo]t|site|web ?site|app)\b/i] },
  { id: 'revise', command: '/okb:revise', okbOnly: false, patterns: [
    /\b(r[ée][ée]cri[st]|reformule|simplifie|vulgarise)\b.{0,30}\b(cette |la |ma )?(fiche|note)\b/i,
    /\brewrite (this|the|my) note\b/i,
  ], not: [/\b(code|fonction|function|mail|e-?mail|message|commit)\b/i] },
  { id: 'skillify', command: '/okb:skillify', okbOnly: true, patterns: [
    /\b(transforme|change|fais)[-\s]?(ce|cette|ma|en)?\s*(process|proc[ée]dure|m[ée]thode)?\s*(en|un) skill\b/i,
    /\bskillify\b|\b(turn|make) (this|my|the) (process|procedure|method)( note)? (into )?a skill\b/i,
  ] },
  { id: 'setup', command: '/okb:setup', okbOnly: true, patterns: [
    /\b(cr[ée]e|ajoute|configure)[-\s]?(moi )?(une )?(nouvelle )?(kb|base de connaissances?)\b/i,
    /\b(configure|installe|set ?up)\s+okb\b|\bnew (okb )?knowledge base\b|\bcreate a (new )?kb\b/i,
  ] },
  { id: 'switch', command: 'okb kb switch', okbOnly: true, patterns: [
    /\b(passe|bascule|change)\s+(sur|vers|à)\s+(la |ma )?kb\b/i,
    /\butilise (la |ma )?kb\b|\bswitch to (my |the )?\w*\s*kb\b|\buse (my |the )\w+ kb\b/i,
  ] },
  { id: 'serve', command: 'okb serve', okbOnly: true, patterns: [
    /\b(ouvre|lance|montre)[-\s]?(moi )?(le lecteur|l['’]interface web|l['’]appli(cation)? web|ma kb dans le navigateur)\b/i,
    /\bopen (the )?okb (web app|reader)\b|\bshow my kb in the browser\b/i,
    /\b(ouvre|montre|affiche)[-\s]?(moi )?(le |mon )?graphe (de |des )?(ma kb|mes notes|ma base|mon second cerveau)\b|\b(show|open) (me )?(the |my )?(kb |knowledge )?graph( of my notes)?\b/i,
  ] },
  { id: 'usage', command: 'okb usage', okbOnly: true, patterns: [
    /\b(combien (me )?co[uû]te|co[uû]ts? d['’]|consommation (de tokens )?d['’]|utilisation d['’]|tokens? (consomm[ée]s? )?par) ?(okb|mon second cerveau)\b/i,
    /\bcombien de tokens? (consomme|utilise|d[ée]pense) (okb|mon second cerveau)\b/i,
    /\bokb (usage|costs?|stats)\b|\bhow much (does|did) okb cost\b|\bmy okb (usage|costs?)\b|\btokens? (used|spent) by okb\b/i,
  ] },
  { id: 'feedback', command: 'okb feedback', okbOnly: true, patterns: [
    /\b(note|signale|remonte|garde)[-\s]?(un |ce |le |mon )?(retour|bug|probl[eè]me|souci|id[ée]e)( d['’]am[ée]lioration)? (sur|pour|à|dans|concernant) okb\b/i,
    /\bokb (feedback|bug report)\b|\b(report|log|note) (a |this |the )?(bug|problem|issue|idea|feedback) (to|for|about|on) okb\b/i,
  ] },
  { id: 'status', command: '/okb:menu', okbOnly: true, patterns: [
    /\bo[ùu] (j['’]en suis|en est) (avec )?(okb|mon second cerveau|ma kb)\b/i,
    /\b(que|qu['’]est[-\s]ce que) (peut faire|fait) okb\b|\bcomment (marche|fonctionne|utiliser) okb\b|\baide okb\b/i,
    /\bokb (help|status)\b|\bwhat can okb do\b|\bhow (do i|to) use okb\b/i,
  ] },
  { id: 'ask', command: '/okb:ask', okbOnly: false, patterns: [
    /\bque dit (ma|mon|la) (kb|base|second cerveau)\b|\bselon (ma|mes|la) (kb|notes|base)\b/i,
    /\b(cherche|retrouve)[-\s]?(moi )?(dans|parmi) (ma |mes |la )?(kb|notes|base|second cerveau)\b/i,
    /\bdans (ma|mes) (kb|notes)\b.{0,40}\?/i,
    /\bwhat do(es)? my (notes|kb|knowledge base) say\b|\bsearch my (notes|kb)\b|\bin my (notes|kb)\b.{0,40}\?/i,
  ] },
];

const OKB_WORDS = /\b(okb|second cerveau|second brain|deuxi[èe]me cerveau)\b/i;
const KNOWLEDGE_NAME = /(kb|knowledge|wiki|support|brain|notes?|docs?|rag|memory|m[ée]moire|confluence|notion|obsidian|base)/i;

export type IntentContext = {
  readonly kbs: readonly { id: string; name: string }[];
  /** Other knowledge tools or agents: configured names plus detected plugins and MCP servers. */
  readonly otherTools: readonly string[];
};

export type IntentSuggestion = {
  readonly intent: IntentId;
  readonly command: string;
  /** offer: propose directly; ask-which: other knowledge tools exist, ask which one is meant. */
  readonly mode: 'offer' | 'ask-which';
  readonly kb: string | null;
  readonly otherTools: readonly string[];
  readonly matched: string;
};

function mentions(text: string, name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[-_\s]+/g, '[-_\\s]+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

/** The offer for one message, or null. Never for slash commands, never for another tool's request. */
export function suggestIntent(message: string, ctx: IntentContext): IntentSuggestion | null {
  const text = message.trim();
  if (!text || text.startsWith('/') || text.length > 20_000) return null;
  const sample = text.length > 1500 ? `${text.slice(0, 1200)}\n${text.slice(-300)}` : text;
  // A request that names another knowledge tool belongs to it.
  const named = ctx.otherTools.filter((t) => mentions(sample, t));
  if (named.length) return null;
  for (const rule of INTENT_RULES) {
    if (rule.not?.some((re) => re.test(sample))) continue;
    const hit = rule.patterns.find((re) => re.test(sample));
    if (!hit) continue;
    const kb = ctx.kbs.find((k) => mentions(sample, k.id) || (k.name !== k.id && mentions(sample, k.name)))?.id ?? null;
    const okbNamed = OKB_WORDS.test(sample) || kb !== null;
    // "the support KB", "la KB support", "le wiki produit": a knowledge base that is not one of OKB's.
    const foreign = kb ? [] : foreignKbNames(sample, ctx);
    const others = [...new Set([...ctx.otherTools, ...foreign])];
    if (foreign.length && !rule.okbOnly && !OKB_WORDS.test(sample)) {
      return { intent: rule.id, command: rule.command, mode: 'ask-which', kb: null, otherTools: others, matched: sample.match(hit)?.[0]?.trim() ?? '' };
    }
    const mode = rule.okbOnly || okbNamed || !others.length ? 'offer' : 'ask-which';
    return { intent: rule.id, command: rule.command, mode, kb, otherTools: others, matched: sample.match(hit)?.[0]?.trim() ?? '' };
  }
  return null;
}

const GENERIC = new Set(['ma', 'mon', 'mes', 'la', 'le', 'les', 'de', 'du', 'des', 'my', 'the', 'this', 'that', 'okb', 'perso', 'personnelle', 'personal', 'actuelle', 'active', 'current', 'principale', 'main']);

function foreignKbNames(text: string, ctx: IntentContext): string[] {
  const known = new Set(ctx.kbs.flatMap((k) => [k.id.toLowerCase(), k.name.toLowerCase()]));
  const out: string[] = [];
  const patterns = [
    /\b(?:kb|base de connaissances?|wiki|knowledge base)\s+(?:de |du |d['’]|of |the )?([\p{L}\d_-]{3,})/giu,
    /\b([\p{L}\d_-]{3,})\s+(?:kb|wiki|knowledge base)\b/giu,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1]!.toLowerCase();
      if (!GENERIC.has(name) && !known.has(name)) out.push(m[1]!);
    }
  }
  return out;
}

/** Knowledge-like plugins and MCP servers installed for Claude Code (OKB excluded). */
export async function detectOtherKnowledgeTools(cwd?: string): Promise<string[]> {
  const home = homedir();
  const names = new Set<string>();
  try {
    const plugins = JSON.parse(await readFile(resolve(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: Record<string, unknown> };
    for (const key of Object.keys(plugins.plugins ?? {})) names.add(key.split('@')[0]!);
  } catch { /* none */ }
  try {
    const cfg = JSON.parse(await readFile(resolve(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> }> };
    for (const key of Object.keys(cfg.mcpServers ?? {})) names.add(key);
    if (cwd) for (const key of Object.keys(cfg.projects?.[cwd]?.mcpServers ?? {})) names.add(key);
  } catch { /* none */ }
  if (cwd) {
    try {
      const mcp = JSON.parse(await readFile(resolve(cwd, '.mcp.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
      for (const key of Object.keys(mcp.mcpServers ?? {})) names.add(key);
    } catch { /* none */ }
  }
  return [...names].filter((n) => n.toLowerCase() !== 'okb' && KNOWLEDGE_NAME.test(n)).sort();
}

/** What the plugin hook hands to Claude: an offer to make, never an action to take. */
export function renderOffer(s: IntentSuggestion, lang: 'fr' | 'en'): string {
  const label: Record<IntentId, [string, string]> = {
    done: ['finir la session (journal + captures)', 'end the session (journal + captures)'],
    ingest: ['importer cette source dans une KB', 'import this source into a KB'],
    ask: ['chercher la réponse dans tes KB', 'look the answer up in your KBs'],
    capture: ['capturer ça dans ton inbox', 'capture this in your inbox'],
    inbox: ['trier ton inbox OKB', 'sort your OKB inbox'],
    focus: ['mettre à jour ton focus', 'update your focus'],
    weekly: ['faire ta revue de la semaine', 'run your weekly review'],
    learn: ['te faire réviser une notion', 'quiz you on a notion'],
    review: ['relire les propositions en attente', 'review the waiting proposals'],
    undo: ['annuler le dernier changement de la KB', 'undo the last KB change'],
    maintain: ['vérifier la santé de ta KB', 'check your KB’s health'],
    revise: ['réécrire cette note dans un autre style', 'rewrite this note in another style'],
    skillify: ['transformer cette procédure en skill', 'turn this procedure into a skill'],
    setup: ['configurer une KB', 'set up a KB'],
    switch: ['changer de KB active', 'switch the active KB'],
    serve: ['ouvrir l’application web OKB (notes, graphe, relecture)', 'open the OKB web app (notes, graph, review)'],
    status: ['montrer où en est ton second cerveau', 'show where your second brain stands'],
    onboard: ['te faire découvrir ce repo et lui créer sa KB (notes sourcées dans le code)', 'onboard you on this repository and build its KB (notes cited from the code)'],
    ticket: ['enrichir la KB de ce repo avec ce ticket', 'enrich this repository’s KB with this ticket'],
    usage: ['montrer ce que coûte OKB (lu dans les journaux locaux, sans dépenser de token)', 'show what OKB costs (read from local logs, no token spent)'],
    feedback: ['noter ce retour pour le rapport d’amélioration d’OKB (okb feedback "…")', 'note this remark for OKB’s improvement report (okb feedback "…")'],
  };
  const what = label[s.intent][lang === 'fr' ? 0 : 1];
  const lines = [
    `OKB suggestion (from the OKB plugin, not from the user): this message looks like a request to ${label[s.intent][1]} (matched: "${s.matched}").`,
    s.mode === 'offer'
      ? `Before anything else, ask the user ONE short question with buttons (AskUserQuestion), in their language — for example « ${lang === 'fr' ? `Je m’en occupe avec OKB (${s.command}) ? — ${what}` : `Shall OKB take this with ${s.command}? — ${what}`} » with the options « ${lang === 'fr' ? 'Oui' : 'Yes'} » and « ${lang === 'fr' ? 'Non, continue sans OKB' : 'No, continue without OKB'} ». Act with OKB only after a yes; on a no, answer normally and do not offer again for this request.`
      : `The user also uses other knowledge tools (${s.otherTools.join(', ')}). Do not assume OKB: ask ONE short question with buttons (AskUserQuestion) whether they mean their OKB knowledge base (${s.command}) or another tool, and continue with the tool they choose.`,
    s.kb ? `The message names the OKB KB "${s.kb}": use --kb ${s.kb}.` : '',
    s.otherTools.length ? `Never read or write the files of another knowledge tool (${s.otherTools.join(', ')}); OKB acts only on its own KBs.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
