import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { FR } from '../src/i18n/fr.js';
import { setLanguage, t, tn } from '../src/i18n/index.js';
import { COMMANDS } from '../src/cli/commands/help.js';
import { SETTINGS } from '../src/settings/settings.js';
import { walkFiles } from '../src/util/fsx.js';
import { TEST_ROOT } from './helpers/sandbox.js';

const SRC = resolve(TEST_ROOT, '..', 'src');

describe('interface catalogue', () => {
  it('has every literal key used in the code, in English and in French', async () => {
    const missing: string[] = [];
    for (const file of (await walkFiles(SRC)).filter((f) => f.endsWith('.ts'))) {
      const text = await readFile(resolve(SRC, file), 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z][\w.-]+)'/g)) if (!(m[1]! in EN) && !/\.md$/.test(m[1]!)) missing.push(`${file}: ${m[1]}`);
      for (const m of text.matchAll(/\btn\(\s*'([\w.-]+)'/g)) for (const n of ['one', 'other']) if (!(`${m[1]}.${n}` in EN)) missing.push(`${file}: ${m[1]}.${n}`);
    }
    expect(missing).toEqual([]);
    expect(Object.keys(FR).sort()).toEqual(Object.keys(EN).sort());
  });

  it('describes every command, setting and error code people can meet', () => {
    for (const c of COMMANDS) expect(EN).toHaveProperty([`help.cmd.${c.name}`]);
    for (const s of SETTINGS) expect(EN).toHaveProperty([`settings.label.${s.key}`]);
    for (const code of ['E_CONFIG', 'E_NOT_FOUND', 'E_UNSUPPORTED', 'E_EXTRACTION', 'E_STALE', 'E_FORBIDDEN_PATH', 'E_NOT_APPROVED', 'E_APPROVAL_MISMATCH', 'E_CONFLICT', 'E_INVALID', 'E_SECRET', 'E_IO', 'E_INTERNAL']) {
      expect(EN).toHaveProperty([`code.${code}.title`]);
      expect(EN).toHaveProperty([`code.${code}.fix`]);
    }
  });

  it('fills placeholders and plurals in both languages', () => {
    setLanguage('fr');
    expect(t('review.approved', { n: 3, id: 'p-1' })).toBe('Approuvée : 3 changements de p-1.');
    expect(tn('review.files', 1)).toBe('1 fichier');
    expect(tn('review.files', 4)).toBe('4 fichiers');
    setLanguage('en');
    expect(tn('review.files', 4)).toBe('4 files');
    expect(t('nope.unknown')).toBe('nope.unknown');
  });
});
