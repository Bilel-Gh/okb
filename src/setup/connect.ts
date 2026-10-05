import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { expandHome } from '../config/load.js';
import { lang, type Lang } from '../i18n/index.js';
import { foreignNotes, kbNames, listKbs, readRootConfig, writeOwner } from '../kb/registry.js';
import { writeSetting } from '../settings/settings.js';
import { OkbError } from '../util/errors.js';
import { checkFolder, defaultAnswers, runWizard, wizardContext } from './wizard.js';

/**
 * Connect a folder of notes that already exists as a KB, under the name the
 * person chose. No note is written: the folder is only marked as OKB's
 * (`.okb/owner.yaml`). Notes written before OKB are counted, for `okb kb convert`.
 */
export async function connectKb(input: { folder: string; name: string; confidential?: boolean; activate?: boolean }, env: NodeJS.ProcessEnv = process.env): Promise<{ id: string; root: string; active: boolean; notesBeforeOkb: number }> {
  const root = resolve(expandHome(input.folder.trim(), env));
  if (!(await stat(root).then((x) => x.isDirectory(), () => false))) throw new OkbError('E_NOT_FOUND', `no folder at ${root}`, { key: 'kbAddMissing', params: { root } });
  const name = input.name.trim();
  if (!name) throw new OkbError('E_INVALID', 'a KB needs a name', { key: 'kbAddNeedsName' });
  const kbs = await listKbs(env);
  const { id } = kbNames(name);
  if (kbs.some((k) => k.id === id)) throw new OkbError('E_CONFLICT', `a KB named "${id}" already exists`, { key: 'kbNameTaken', params: { id } });
  // A folder marked by a KB that is no longer installed (removed earlier) can be taken back.
  const check = await checkFolder(root, id, env);
  if (check.state === 'okb' && check.owner && check.owner !== id && !kbs.some((k) => k.id === check.owner)) await writeOwner(root, id);
  const wctx = await wizardContext(env);
  const activate = kbs.length === 0 || Boolean(input.activate);
  const answers = {
    ...defaultAnswers(wctx, name, lang()),
    // Keep the interface language already chosen on this computer.
    uiLanguage: (await readRootConfig(env)).ui?.language ?? ('auto' as Lang | 'auto'),
    root, adopt: true, focus: 'later' as const, plugin: false, launcher: null, activate,
  };
  const created = await runWizard(answers, () => undefined, env);
  if (input.confidential) await writeSetting(created.id, 'kb.confidential', true, env);
  return { id: created.id, root: created.root, active: activate, notesBeforeOkb: (await foreignNotes(root, 100_000)).length };
}
