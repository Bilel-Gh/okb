import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { parseUpdatePolicy } from '../dist/desktop/policy.js';
const file = new URL('../desktop/update-policy.json', import.meta.url);
const previous = await readFile(file, 'utf8');
const signed = process.env.OKB_SIGNED_RELEASE === '1';
const policy = signed ? parseUpdatePolicy({ stable: process.env.OKB_UPDATE_STABLE, preview: process.env.OKB_UPDATE_PREVIEW, publisher: process.env.OKB_SIGNING_PUBLISHER }) : { enabled: false };
try {
  await writeFile(file, JSON.stringify(policy, null, 2) + '\n');
  const cli = new URL('../node_modules/electron-builder/out/cli/cli.js', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(cli), '--config', 'electron-builder.config.mjs', '--publish', 'never', ...process.argv.slice(2)], { stdio: 'inherit', shell: false });
    child.once('error', reject); child.once('exit', done);
  });
  if (code !== 0) process.exitCode = typeof code === 'number' ? code : 1;
} finally { await writeFile(file, previous); }
