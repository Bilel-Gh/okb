/**
 * Public Claude API prices, to turn the tokens Claude Code logs into a cost.
 * With a Claude subscription nothing is billed per token: the figure is then
 * what the same work would cost through the API, a stable yardstick to
 * compare workflows and settings.
 *
 * Source: platform.claude.com/docs/en/about-claude/pricing, read on 2026-10-04.
 * USD per million tokens.
 */
export type Price = {
  readonly input: number;
  readonly write5m: number;
  readonly write1h: number;
  readonly read: number;
  readonly output: number;
};

export const PRICES_AS_OF = '2026-10-04';

const p = (input: number, read: number, output: number): Price => ({ input, write5m: input * 1.25, write1h: input * 2, read, output });

/** Longest prefix wins: `claude-opus-5-5` before `claude-opus-5`. */
const TABLE: readonly (readonly [string, Price])[] = [
  ['claude-fable-5-1', p(10, 0.25, 50)],
  ['claude-mythos-5-1', p(10, 0.25, 50)],
  ['claude-fable-5', p(10, 1, 50)],
  ['claude-mythos-5', p(10, 1, 50)],
  ['claude-opus-5-5', p(4, 0.2, 20)],
  ['claude-opus-5', p(5, 0.5, 25)],
  ['claude-opus-4-8', p(5, 0.5, 25)],
  ['claude-opus-4-7', p(5, 0.5, 25)],
  ['claude-opus-4-6', p(5, 0.5, 25)],
  ['claude-opus-4-5', p(5, 0.5, 25)],
  ['claude-opus-4-1', p(15, 1.5, 75)],
  ['claude-opus-4', p(15, 1.5, 75)],
  ['claude-sonnet-5-5', p(2, 0.2, 10)],
  ['claude-sonnet-5', p(2, 0.2, 10)],
  ['claude-sonnet-4', p(3, 0.3, 15)],
  ['claude-haiku-4-5', p(1, 0.1, 5)],
  ['claude-3-5-haiku', p(0.8, 0.08, 4)],
];

/** Fast mode: a premium on input and output, cache multipliers on top. */
const FAST: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-opus-5-5': { input: 8, output: 40 },
  'claude-opus-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 10, output: 50 },
};

export function priceOf(model: string, speed: 'standard' | 'fast' = 'standard'): Price | null {
  const id = model.toLowerCase();
  const found = TABLE.filter(([prefix]) => id.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
  if (!found) return null;
  const [prefix, base] = found;
  const fast = speed === 'fast' ? FAST[prefix] : undefined;
  if (!fast) return base;
  const readRatio = base.read / base.input;
  return { input: fast.input, write5m: fast.input * 1.25, write1h: fast.input * 2, read: fast.input * readRatio, output: fast.output };
}

export type Tokens = {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};

export const noTokens = (): Tokens => ({ input: 0, output: 0, write5m: 0, write1h: 0, read: 0 });

export function addTokens(into: Tokens, more: Tokens): Tokens {
  into.input += more.input;
  into.output += more.output;
  into.write5m += more.write5m;
  into.write1h += more.write1h;
  into.read += more.read;
  return into;
}

export const totalTokens = (t: Tokens): number => t.input + t.output + t.write5m + t.write1h + t.read;

/** USD for these tokens on this model; 0 for an unknown model (reported apart). */
export function costOf(model: string, tokens: Tokens, speed: 'standard' | 'fast' = 'standard'): number {
  const price = priceOf(model, speed);
  if (!price) return 0;
  return (tokens.input * price.input + tokens.write5m * price.write5m + tokens.write1h * price.write1h + tokens.read * price.read + tokens.output * price.output) / 1_000_000;
}

/** "claude-opus-5-5" → "Opus 5.5". */
export function modelLabel(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model.toLowerCase());
  if (!m) return model;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  const minor = m[3] && m[3].length <= 2 ? `.${m[3]}` : '';
  return `${family} ${m[2]}${minor}`;
}
