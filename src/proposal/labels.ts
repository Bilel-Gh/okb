import { BUILTIN_CATEGORIES } from '../categories/categories.js';
import { lang, t } from '../i18n/index.js';

/**
 * A change's label is written once, in English, into the proposal (it is data,
 * read by the CLI, the receipts and the tests). What a person reads — the title
 * of a proposal in the app or the terminal — is that label in their language:
 * the note by its name, the type by its label. A label OKB does not know stays
 * as it was written.
 */
const note = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '');
const category = (id: string) => {
  const c = BUILTIN_CATEGORIES.find((x) => x.id === id);
  return c ? c.label[lang()] : id;
};
const LEVEL: Record<string, string> = { secret: 'proposal.label.level.secret', private: 'proposal.label.level.private', normal: 'proposal.label.level.normal' };

/** Pattern → message; the optional « : <path> » a mechanical change appends is left out of a title. */
const RULES: readonly [RegExp, (m: RegExpMatchArray) => string][] = [
  // The notes a proposal carries about itself.
  [/^(.+\.md): category back to automatic\b.*$/, (m) => t('proposal.label.categoryAuto', { note: note(m[1]!) })],
  [/^(.+\.md): category (\S+) → (\S+)$/, (m) => t('proposal.label.category', { note: note(m[1]!), from: category(m[2]!), to: category(m[3]!) })],
  [/^(.+\.md): confidentiality → (\w+)$/, (m) => t('proposal.label.confidentiality', { note: note(m[1]!), level: LEVEL[m[2]!] ? t(LEVEL[m[2]!]!) : m[2]! })],
  [/^category of (.+): back to automatic$/, (m) => t('proposal.label.categoryAuto', { note: note(m[1]!) })],
  [/^category of (.+): (\S+) → (\S+)$/, (m) => t('proposal.label.category', { note: note(m[1]!), from: category(m[2]!), to: category(m[3]!) })],
  [/^confidentiality of (.+): (\w+)$/, (m) => t('proposal.label.confidentiality', { note: note(m[1]!), level: LEVEL[m[2]!] ? t(LEVEL[m[2]!]!) : m[2]! })],
  [/^create concept card (.+)$/, (m) => t('proposal.label.concept', { note: note(m[1]!) })],
  [/^create (.+)$/, (m) => t('proposal.label.create', { note: note(m[1]!) })],
  [/^append "(.+)" to (.+)$/, (m) => t('proposal.label.append', { heading: m[1]!, note: note(m[2]!) })],
  [/^link (.+) in (.+)$/, (m) => t('proposal.label.link', { term: m[1]!, note: note(m[2]!) })],
  [/^subject page (.+)$/, (m) => t('proposal.label.subject', { note: note(m[1]!) })],
  [/^revise (.+)$/, (m) => t('proposal.label.revise', { note: note(m[1]!) })],
  [/^merge pack (.+?) from (.+?)(?:: .+)?$/, (m) => t('proposal.label.pack', { brain: m[2]!, subject: note(m[1]!) })],
  [/^translate (.+) → ([\w-]+)(?:: .+)?$/, (m) => t('proposal.label.translate', { note: note(m[1]!), lang: m[2]!.toUpperCase() })],
  [/^restore (.+) \(version (\d+)\)(?:: .+)?$/, (m) => t('proposal.label.restore', { note: note(m[1]!), n: m[2]! })],
  [/^restore (.+) from the trash(?:: .+)?$/, (m) => t('proposal.label.untrash', { note: note(m[1]!) })],
  [/^move (.+) to (.+?)(?:: .+)?$/, (m) => t('proposal.label.move', { from: note(m[1]!), to: m[2]! })],
  [/^navigation refresh(?:: .+)?$/, () => t('proposal.label.navigation')],
  [/^brain repair(?:: .+)?$/, () => t('proposal.label.repair')],
  [/^brain migration \([\w-]+, (\d+) notes\)(?:: .+)?$/, (m) => t('proposal.label.migration', { n: m[1]! })],
  [/^conversion to the OKB format \((\d+) notes\)(?:: .+)?$/, (m) => t('proposal.label.conversion', { n: m[1]! })],
  [/^portable-links migration(?:: .+)?$/, () => t('proposal.label.portable')],
];

export function readableLabel(label: string): string {
  for (const [re, say] of RULES) {
    const m = re.exec(label);
    if (m) return say(m);
  }
  return label;
}
