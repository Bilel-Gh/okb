import { homedir } from 'node:os';
import { sep } from 'node:path';
import pc from 'picocolors';

/**
 * The terminal look of OKB: one palette, one set of symbols, rounded tables
 * and boxes, links a terminal can click. Colour and links only reach a real
 * terminal: piped output, `--json`, `NO_COLOR` and Claude's Bash tool get
 * plain text, so an agent never reads escape codes.
 */
const stream = process.stdout;
let colorOn = Boolean(stream.isTTY) && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb';
if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') colorOn = true;

export function setColor(on: boolean): void {
  colorOn = on;
  c = pc.createColors(on);
}
/** A path for people: the home folder written `~`. */
export function tilde(p: string): string {
  const home = homedir();
  return p === home ? '~' : p.startsWith(home + sep) ? `~${p.slice(home.length)}` : p;
}

export function colorEnabled(): boolean {
  return colorOn;
}

let c = pc.createColors(colorOn);

/** Brand palette: ink for text, emerald for the brand, semantic colours for states. */
export const paint = {
  brand: (s: string) => (colorOn ? `\x1b[38;5;36m${s}\x1b[39m` : s),
  accent: (s: string) => c.cyan(s),
  ok: (s: string) => c.green(s),
  info: (s: string) => c.blue(s),
  warn: (s: string) => c.yellow(s),
  err: (s: string) => c.red(s),
  dim: (s: string) => c.dim(s),
  bold: (s: string) => c.bold(s),
  added: (s: string) => c.green(s),
  removed: (s: string) => c.red(s),
  code: (s: string) => c.cyan(s),
};

export const sym = {
  ok: () => paint.ok('✔'),
  info: () => paint.info('ℹ'),
  warn: () => paint.warn('⚠'),
  err: () => paint.err('✖'),
  tip: () => '💡',
  arrow: () => paint.dim('→'),
  bullet: () => paint.dim('•'),
  star: () => paint.warn('★'),
  kb: () => '📚',
};

/** Terminals known to draw OSC 8 hyperlinks; others get "label (url)". */
function hyperlinks(): boolean {
  if (!stream.isTTY || 'NO_HYPERLINKS' in process.env) return false;
  const tp = process.env.TERM_PROGRAM ?? '';
  if (tp === 'Apple_Terminal') return false;
  return ['iTerm.app', 'vscode', 'WezTerm', 'ghostty', 'Hyper', 'Tabby'].includes(tp) || Boolean(process.env.KITTY_WINDOW_ID || process.env.WT_SESSION || process.env.VTE_VERSION);
}

export function link(label: string, url: string): string {
  if (hyperlinks()) return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
  return label === url ? url : `${label} ${paint.dim(`(${url})`)}`;
}

export function fileLink(label: string, absolutePath: string): string {
  return link(label, `file://${encodeURI(absolutePath)}`);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;
export function strip(s: string): string {
  return s.replace(ANSI, '');
}

/** Code points shown as wide emoji even without U+FE0F (Unicode Emoji_Presentation, BMP part). */
const WIDE_BMP = new Set([0x231a, 0x231b, 0x23e9, 0x23ea, 0x23eb, 0x23ec, 0x23f0, 0x23f3, 0x25fd, 0x25fe, 0x2614, 0x2615, 0x267f, 0x2693, 0x26a1, 0x26aa, 0x26ab, 0x26bd, 0x26be, 0x26c4, 0x26c5, 0x26ce, 0x26d4, 0x26ea, 0x26f2, 0x26f3, 0x26f5, 0x26fa, 0x26fd, 0x2705, 0x270a, 0x270b, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27b0, 0x27bf, 0x2b1b, 0x2b1c, 0x2b50, 0x2b55]);

/** Display width: wide glyphs (emoji, CJK) count twice, joiners and marks count zero. */
export function width(s: string): number {
  const chars = [...strip(s)];
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i]!.codePointAt(0)!;
    if (cp === 0xfe0f || cp === 0x200d || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue;
    const emojiVs = chars[i + 1] === '\ufe0f';
    const wide = emojiVs || cp >= 0x1f000 || WIDE_BMP.has(cp) || (cp >= 0x2648 && cp <= 0x2653)
      || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60);
    w += wide ? 2 : 1;
  }
  return w;
}

export function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  if (max <= 1) return max === 1 ? '…' : '';
  let out = '';
  for (const ch of strip(s)) {
    if (width(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));

export function columns(): number {
  return Math.max(40, Math.min(stream.columns ?? 100, 160));
}

/**
 * A rounded table that fits the terminal: the widest flexible column shrinks
 * first, cells are cut with an ellipsis rather than wrapping.
 */
export function table(rows: readonly (readonly string[])[], options: { head?: readonly string[]; flex?: number; border?: boolean } = {}): string {
  const all = options.head ? [options.head, ...rows] : [...rows];
  if (!all.length) return '';
  const n = Math.max(...all.map((r) => r.length));
  const widths = Array.from({ length: n }, (_, i) => Math.max(...all.map((r) => width(r[i] ?? ''))));
  const border = options.border ?? true;
  const overhead = border ? 3 * n + 1 : 2 * (n - 1);
  const flex = options.flex ?? widths.indexOf(Math.max(...widths));
  const excess = widths.reduce((a, b) => a + b, 0) + overhead - columns();
  if (excess > 0) widths[flex] = Math.max(8, widths[flex]! - excess);
  const line = (cells: readonly string[], style: (s: string) => string = (s) => s) => {
    const parts = widths.map((w, i) => pad(style(truncate(cells[i] ?? '', w)), w));
    return border ? `${paint.dim('│')} ${parts.join(` ${paint.dim('│')} `)} ${paint.dim('│')}` : parts.join('  ').trimEnd();
  };
  const rule = (l: string, m: string, r: string) => paint.dim(`${l}${widths.map((w) => '─'.repeat(w + 2)).join(m)}${r}`);
  const out: string[] = [];
  if (border) out.push(rule('╭', '┬', '╮'));
  if (options.head) {
    out.push(line(options.head, (s) => paint.bold(s)));
    if (border) out.push(rule('├', '┼', '┤'));
  }
  for (const r of rows) out.push(line(r));
  if (border) out.push(rule('╰', '┴', '╯'));
  return out.join('\n');
}

export type Tone = 'brand' | 'ok' | 'info' | 'warn' | 'err' | 'plain';
const toneColor: Record<Tone, (s: string) => string> = {
  brand: paint.brand, ok: paint.ok, info: paint.info, warn: paint.warn, err: paint.err, plain: paint.dim,
};

/** A rounded box with an optional title, sized to its content and the terminal. */
export function box(lines: readonly string[], options: { title?: string; tone?: Tone } = {}): string {
  const color = toneColor[options.tone ?? 'plain'];
  const inner = Math.min(columns() - 4, Math.max(width(options.title ?? '') + 2, ...lines.map(width)));
  const title = options.title ? ` ${options.title} ` : '';
  const top = color(`╭─${title}${'─'.repeat(Math.max(0, inner - width(title) + 1))}╮`);
  const body = lines.map((l) => `${color('│')} ${pad(truncate(l, inner), inner)} ${color('│')}`);
  return [top, ...body, color(`╰${'─'.repeat(inner + 2)}╯`)].join('\n');
}

export function banner(version: string, subtitle: string): string {
  const mark = paint.brand('◆');
  return `\n  ${mark} ${paint.bold('OKB')} ${paint.dim(`v${version}`)}  ${paint.dim('·')}  ${subtitle}\n`;
}

export function heading(text: string): string {
  return `\n${paint.bold(text)}`;
}

/** A diff line coloured by its sign. */
export function diffLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return paint.bold(line);
  if (line.startsWith('@@')) return paint.accent(line);
  if (line.startsWith('+')) return paint.added(line);
  if (line.startsWith('-')) return paint.removed(line);
  return line;
}
