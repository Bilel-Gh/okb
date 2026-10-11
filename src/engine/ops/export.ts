import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { insideBackupPath, physicalBackupTarget, withFreshVerifiedBackup } from '../../brain/backup.js';
import { statePaths } from '../../state/paths.js';
import { OkbError } from '../../util/errors.js';
import { asBundlePath } from '../../util/paths.js';
import { sha256 } from '../../util/hash.js';
import { defineOperation } from '../operation.js';

export const exportSpace = defineOperation({
  id: 'space.export', module: 'core', effect: 'state', agents: false,
  summary: 'The person exports a complete verified snapshot into a new empty folder, never the approval key.',
  input: z.object({ folder: z.string().trim().min(1).max(1000) }).strict(),
  async run({ config, env }, input) {
    const target = await physicalBackupTarget(input.folder);
    for (const root of [config.kb.root, statePaths(config).root]) {
      const physical = await physicalBackupTarget(root);
      if (insideBackupPath(physical, target) || insideBackupPath(target, physical)) throw new OkbError('E_FORBIDDEN_PATH', 'choose an export folder outside the notes and their private state');
    }
    const existing = await lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(target)).length)) throw new OkbError('E_CONFLICT', 'the export folder must be empty');
    return withFreshVerifiedBackup(config, env, async (backup, manifest) => {
      const bytes = await readFile(resolve(backup.path, 'manifest.json'));
      await mkdir(target, { recursive: true, mode: 0o700 });
      for (const [key, expected] of Object.entries(manifest.files)) {
        asBundlePath(key);
        const data = await readFile(resolve(backup.path, key));
        if (sha256(data) !== expected.sha256) throw new OkbError('E_IO', 'the snapshot changed during export; retry into a new empty folder');
        const dest = resolve(target, key); await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
        await writeFile(dest, data, { flag: 'wx', mode: 0o600 });
      }
      await writeFile(resolve(target, 'LIRE-MOI.txt'), 'OKB — export personnel complet\n\nkb/ : notes et documents originaux.\nstate/ : état privé, projets, conversations, apprentissage et tickets.\nprofile/ : réglages de cet espace.\nmanifest.json : empreintes de chaque fichier et date de sauvegarde.\n\nCet export contient vos données privées. Pour transmettre du savoir à un collègue, utilisez un tiroir partagé.\nLa clé d’approbation est exclue : une nouvelle installation doit créer sa propre clé.\nLe format est celui de « okb backup » : consultez le guide export-et-restauration pour restaurer dans un nouvel espace.\n', { flag: 'wx', mode: 0o600 });
      // Written last: an interrupted export has no complete manifest and is never presented as successful.
      await writeFile(resolve(target, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
      return { ok: true, to: target, files: Object.keys(manifest.files).length, verified: true, date: backup.date, format: 'okb-backup-v1' };
    });
  },
});
