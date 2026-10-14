import { OkbError } from '../util/errors.js';
export type ParsedArgs = {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | string[]>>;
};

/** `--key value`, `--key=value`, `--flag`, `--no-flag`, repeated keys become arrays. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  const booleans = new Set(['json','help','list','diff','approve','discard','resume','reprocess','extract-only','dry-run','write','defaults','allow-bundle-absolute','raw-digest','template','skeleton','check-sources','yes','verbose','quiet','all','fix','brief','context','force','adopt','print','open','plugin','version','suggest','stdin','everywhere','keep-open','retire','finish','auto','in-repo','build','connect','confidential','queue','over-budget','gaps','error-stdin','example','coverage','meeting-report']);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    if (body === '') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    const eq = body.indexOf('=');
    let key: string;
    let value: string | boolean;
    if (eq !== -1) {
      key = body.slice(0, eq);
      value = body.slice(eq + 1);
    } else if (booleans.has(body)) {
      key = body; value = true;
    } else if (body.startsWith('no-')) {
      key = body.slice(3);
      value = false;
    } else {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        key = body;
        value = next;
        i += 1;
      } else {
        key = body;
        value = true;
      }
    }
    const existing = flags[key];
    if (existing === undefined) flags[key] = value;
    else if (Array.isArray(existing)) existing.push(String(value));
    else flags[key] = [String(existing), String(value)];
  }

  return { command, positionals, flags };
}

export function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  if (value === undefined || typeof value === 'boolean') return undefined;
  return Array.isArray(value) ? value[value.length - 1] : value;
}

export function flagBool(args: ParsedArgs, key: string, fallback = false): boolean {
  const value = args.flags[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return value !== 'false' && value !== '0';
}

export function flagList(args: ParsedArgs, key: string): string[] {
  const value = args.flags[key];
  if (value === undefined || typeof value === 'boolean') return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}

/** Every value of a repeatable flag, without splitting on commas (free text). */
export function flagValues(args: ParsedArgs, key: string): string[] {
  const value = args.flags[key];
  if (value === undefined || typeof value === 'boolean') return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

export function flagNumber(args: ParsedArgs, key: string): number | undefined {
  const raw = flagString(args, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || (key === 'limit' && n === 0)) throw new OkbError('E_INVALID', `--${key} must be a ${key === 'limit' ? 'positive' : 'nonnegative'} integer`);
  return n;
}
