// Render the application's existing default Atelier SVG, without redesigning its mark.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
if (process.platform !== 'darwin') throw new Error('Icon regeneration uses macOS sips and iconutil. The generated icons are checked in for builds on other systems.');
const exec = promisify(execFile);
const temp = await mkdtemp(resolve(tmpdir(), 'okb-icon-'));
const out = resolve('desktop', 'icons'); await mkdir(out, { recursive: true });
try {
  const svg = (await readFile('docs/design/logos/svg/C1-atelier-plat.svg', 'utf8')).replace('width="256" height="256"', 'width="1024" height="1024"');
  const source = resolve(temp, 'mark.svg'); await writeFile(source, svg);
  const master = resolve(temp, 'mark.png'); await exec('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', master]);
  const set = resolve(temp, 'OKB.iconset'); await mkdir(set);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    await exec('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), master, '--out', resolve(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
  await exec('/usr/bin/iconutil', ['-c', 'icns', set, '-o', resolve(out, 'OKB.icns')]);
  const png = await readFile(resolve(set, 'icon_256x256.png'));
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  await writeFile(resolve(out, 'OKB.ico'), Buffer.concat([header, png]));
} finally { await rm(temp, { recursive: true, force: true }); }
