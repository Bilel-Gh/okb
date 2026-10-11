import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '../../src/i18n/en.js';
import { FR } from '../../src/i18n/fr.js';
import { EN_V1 } from '../../src/i18n/v1.en.js';
import { FR_V1 } from '../../src/i18n/v1.fr.js';
import { TEST_ROOT } from '../helpers/sandbox.js';

/** Every message the web app names by a literal key (t('…'), tn(t, '…'), label: '…', hint: '…'). */
function appKeys(): string[] {
  const root = resolve(TEST_ROOT, '..', 'web-app', 'src');
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(name)) files.push(p); } };
  walk(root);
  const keys = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\b(?:t|tn)\(\s*(?:t,\s*)?'([a-zA-Z][\w.-]+)'/g)) keys.add(m[1]!);
    for (const m of text.matchAll(/(?:label|hint): '([a-z]+\.[\w.-]+)'/g)) keys.add(m[1]!);
  }
  return [...keys];
}

describe('simple words on screen (F2.0-02)', () => {
  it('no message of the app says « KB », « bundle » or « proposition »: these words stay in the code', () => {
    const fr = { ...FR, ...FR_V1 } as Record<string, string>;
    const en = { ...EN, ...EN_V1 } as Record<string, string>;
    // The settings page builds its labels from each setting's key: every one of them is on screen too.
    const settings = Object.keys(fr).filter((k) => /^settings\.(label|explain|opt|hint)\./.test(k));
    const keys = [...appKeys().flatMap((k) => [k, `${k}.one`, `${k}.other`]), ...settings];
    expect(keys.length).toBeGreaterThan(500);
    const internal = { fr: /\bKB\b|\b[Bb]undles?\b|\b[Pp]ropositions?\b/, en: /\bKB\b|\b[Bb]undles?\b|\b[Pp]roposals?\b/ };
    // A parameter ({kb}) and a command to type (okb kb convert) are not words of the interface.
    const shown = (text: string) => text.replace(/\{[^}]*\}/g, '').replace(/\bokb [a-z -]+/g, '');
    const offenders = keys.flatMap((k) => [
      ...(fr[k] && internal.fr.test(shown(fr[k]!)) ? [`fr ${k}: ${fr[k]}`] : []),
      ...(en[k] && internal.en.test(shown(en[k]!)) ? [`en ${k}: ${en[k]}`] : []),
    ]);
    expect(offenders).toEqual([]);
  });

  it('every message the app names exists in French and in English', () => {
    const fr = { ...FR, ...FR_V1 } as Record<string, string>;
    const en = { ...EN, ...EN_V1 } as Record<string, string>;
    const has = (c: Record<string, string>, k: string) => k in c || `${k}.one` in c || `${k}.other` in c;
    const missing = appKeys().filter((k) => !has(fr, k) || !has(en, k));
    expect(missing).toEqual([]);
  });
});
