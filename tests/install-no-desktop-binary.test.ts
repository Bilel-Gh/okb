import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandEnv } from '../src/integrations/system.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const ROOT = resolve(TEST_ROOT, '..');

/**
 * The command line and the web app never run Electron. Installing or updating
 * them must not wait on its binary (a download of its own, which a company
 * network often refuses): only the desktop scripts fetch it.
 */
describe('installing OKB without the desktop binary', () => {
  it('the install script skips the Electron binary before installing dependencies', async () => {
    const script = await readFile(resolve(ROOT, 'scripts/install.sh'), 'utf8');
    const skip = script.indexOf('ELECTRON_SKIP_BINARY_DOWNLOAD');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(script.indexOf('npm ci'));
  });

  it('`okb update` skips it too, unless the person decided otherwise', () => {
    expect(commandEnv({}).ELECTRON_SKIP_BINARY_DOWNLOAD).toBe('1');
    expect(commandEnv({ ELECTRON_SKIP_BINARY_DOWNLOAD: '0' }).ELECTRON_SKIP_BINARY_DOWNLOAD).toBe('0');
    expect(commandEnv({}).GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('the desktop scripts fetch the binary they need', async () => {
    const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['desktop:dev']).toContain('node_modules/electron/install.js');
  });
});
