import { afterEach, describe, expect, it } from 'vitest';
import { lang, setLanguage } from '../src/i18n/index.js';
import { readableLabel } from '../src/proposal/labels.js';

const before = lang();
afterEach(() => setLanguage(before));

describe('a proposal’s title in the person’s words', () => {
  it('in French: the type, the confidentiality, a new note, a pack, a translation', () => {
    setLanguage('fr');
    expect(readableLabel('category of 2 Produits/Atlas/Quota.md: concept → guide')).toBe('Type de « Quota » : Concepts → Comprendre');
    expect(readableLabel('category of a/Quota.md: back to automatic')).toBe('Type de « Quota » : de nouveau automatique');
    expect(readableLabel('confidentiality of a/Coffre.md: secret')).toBe('« Coffre » devient 🔒 confidentielle');
    expect(readableLabel('create concept card 3 Boîte à outils/Concepts/SLA.md')).toBe('Fiche concept « SLA »');
    expect(readableLabel('create a/Nouvelle.md')).toBe('Nouvelle note « Nouvelle »');
    expect(readableLabel('merge pack 2 Produits/Atlas/Code/atlas-api from Cerveau de Camille: 2 Produits/Atlas/Code/atlas-api/Piège.md')).toBe('Pack de Cerveau de Camille : atlas-api');
    expect(readableLabel('translate a/Idempotence.md → en: a/Idempotence (EN).md')).toBe('Traduction de « Idempotence » en EN');
    expect(readableLabel('restore a/Note.md (version 3): a/Note.md')).toBe('« Note » revient à la version 3');
    expect(readableLabel('navigation refresh: index.md')).toBe('Navigation mise à jour');
    // The proposal's own notes, shown with its checks.
    expect(readableLabel('1 Écosystème/Logistique/Quota.md: category concept → guide')).toBe('Type de « Quota » : Concepts → Comprendre');
    expect(readableLabel('a/Coffre.md: confidentiality → secret')).toBe('« Coffre » devient 🔒 confidentielle');
  });

  it('in English, and anything unknown stays as written', () => {
    setLanguage('en');
    expect(readableLabel('category of a/Quota.md: concept → guide')).toBe('Type of “Quota”: Concepts → Understand');
    expect(readableLabel('link SLA in a/Contrat.md')).toBe('Link to SLA in “Contrat”');
    expect(readableLabel('Something new entirely')).toBe('Something new entirely');
  });
});
