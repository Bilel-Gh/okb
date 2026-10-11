import { spawn } from 'node:child_process';
// Publishing stays a separate human action. A distributable release must be signed and pass browser journeys.
if (process.env.OKB_SIGNED_RELEASE !== '1') throw new Error('desktop:release requires OKB_SIGNED_RELEASE=1, certificates, notarization and the pinned update feeds. Use desktop:dir for the unsigned prototype.');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this command with npm run desktop:release.');
async function run(command, args) {
  const code = await new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject); child.once('exit', done);
  });
  if (code !== 0) throw new Error(`Desktop release check failed (${code ?? 'signal'}).`);
}
await run(process.execPath, [npmCli, 'run', 'release:check']);
await run(process.execPath, [npmCli, 'run', 'test:journeys']);
await run(process.execPath, ['scripts/desktop-build.mjs', ...process.argv.slice(2)]);
