import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_ROOT } from './helpers/sandbox.js';

const SRC = resolve(TEST_ROOT, '..', 'src');

/** The developer module's code (src/modules/catalog.ts): repositories, tickets, architecture, code review, repository level. */
const DEV = ['repo', 'work', 'arch', 'dev', 'knowledge'];
/** Where the modules meet: the adapters and the engine's registry may import every module. */
const MEETING = [/^cli\//, /^web\//, /^engine\/registry\.ts$/, /^engine\/mcp\.ts$/, /^modules\/wire\.ts$/];

/**
 * Known debt (F2.0-25): core files that still import the developer module.
 * This list can only shrink. The links about tickets went when the Project
 * joined the core (2.0, iteration 5). What stays is about discovering
 * repositories at set-up and the product › repository layout of a work brain.
 */
const KNOWN = [
  'brain/migrate.ts -> repo/registry',
  'brain/products.ts -> repo/pack',
  'brain/products.ts -> repo/registry',
  'brain/session.ts -> repo/registry',
  'kb/convert.ts -> repo/registry',
  'pipeline/ask.ts -> work/rank',
  'setup/discover.ts -> repo/confidential',
  'setup/discover.ts -> repo/git',
  'setup/discover.ts -> repo/registry',
  'setup/discover.ts -> work/kinds',
  'setup/discover.ts -> work/workspaces',
  'setup/wizard.ts -> work/kinds',
];

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('the core and the modules (F2.0-25)', () => {
  it('the core does not import the developer module, beyond the known debt that can only shrink', async () => {
    const edges = new Set<string>();
    for (const file of await files(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (DEV.includes(rel.split('/')[0]!) || MEETING.some((m) => m.test(rel))) continue;
      const text = await readFile(file, 'utf8');
      for (const m of text.matchAll(/(?:from\s+|import\()\s*'(\.{1,2}\/[^']+)\.js'/g)) {
        const target = relative(SRC, resolve(file, '..', m[1]!)).split('\\').join('/');
        if (DEV.includes(target.split('/')[0]!)) edges.add(`${rel} -> ${target}`);
      }
    }
    const found = [...edges].sort();
    expect(found.filter((e) => !KNOWN.includes(e)), 'new links from the core to the developer module').toEqual([]);
    expect(KNOWN.filter((e) => !edges.has(e)), 'links that are gone: remove them from KNOWN').toEqual([]);
  });
});
