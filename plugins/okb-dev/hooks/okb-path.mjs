/**
 * Where the `okb` command is, for the hooks of a module: the core plugin puts
 * it on the Bash PATH, but a hook runs before any Bash call. In order: an
 * explicit OKB_CLI, the launcher OKB installs (~/.okb/bin/okb), the core
 * plugin beside this one (marketplace checkout or cache), then the PATH.
 */
import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runnable = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };

export function okbPath() {
  const candidates = [process.env.OKB_CLI, resolve(process.env.OKB_HOME || resolve(homedir(), '.okb'), 'bin', 'okb')];
  // In a checkout of the marketplace: plugins/okb-dev/hooks → plugin/bin/okb.
  candidates.push(resolve(here, '..', '..', '..', 'plugin', 'bin', 'okb'));
  // In Claude Code's cache: cache/<marketplace>/okb-dev/<version>/hooks → cache/<marketplace>/okb/<version>/bin/okb.
  try {
    const core = resolve(here, '..', '..', '..', 'okb');
    for (const v of readdirSync(core).sort().reverse()) candidates.push(resolve(core, v, 'bin', 'okb'));
  } catch { /* not in a cache */ }
  for (const dir of String(process.env.PATH || '').split(delimiter)) if (dir) candidates.push(resolve(dir, 'okb'));
  return candidates.find((p) => p && runnable(p)) ?? null;
}
