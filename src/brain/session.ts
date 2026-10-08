import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import type { BrainLayout } from './layout.js';
import { nowView, renderNow } from './now.js';
import { brainShape } from './views.js';

/**
 * What Claude gets when a session starts: the brain's drawers and subjects, « Maintenant »,
 * the subject of the folder it opens in, and the rules for a new note. Short on purpose
 * (≤ ~800 tokens whatever the size of the brain: `okb metrics` measures it).
 */
export async function sessionBrief(config: OkbConfig, layout: BrainLayout, bundle: Bundle, cwd?: string): Promise<string> {
  const name = config.profile.displayName || config.profile.id;
  const shape = brainShape(layout, bundle);
  const lines: string[] = [];
  lines.push(`OKB brain "${name}" (${layout.preset}, ${bundle.entries.length} notes) at ${config.kb.root}. Drawers: ${shape.drawers.map((d) => `${d.folder} (${d.notes})`).join(' · ')}.`);
  const subjects = shape.drawers.find((d) => d.drawer === 'subjects')!.subjects;
  if (subjects.length) lines.push(`${layout.preset === 'work' ? 'Products' : 'Subjects'}: ${subjects.slice(0, 15).map((x) => x.name).join(', ')}${subjects.length > 15 ? ', …' : ''}.`);
  if (cwd) {
    const { repoForDir } = await import('../repo/registry.js');
    const found = await repoForDir(cwd).catch(() => null);
    if (found && found.repo.kb === config.profile.id) {
      const { repoPlace } = await import('./products.js');
      const place = await repoPlace(config, found.repo);
      if (typeof place === 'object') {
        const hub = `${place.folder}/${place.name}.md`;
        lines.push(`This folder is repository ${found.repo.name}: its notes are in ${place.folder}/${bundle.byPath.has(hub as never) ? ` (start with ${hub})` : ' (no page yet)'}.`);
      }
    }
  }
  const now = renderNow(await nowView(config, bundle), layout.lang);
  lines.push('', `« ${layout.lang === 'fr' ? 'Maintenant' : 'Now'} »:`, now);
  lines.push('', 'Notes: never write one without the person\'s yes. Before writing, show a suggestion card (type, exact place from `okb where <type> --title … --product … --repo …`, why, notes that already cover it from `okb ask`, estimated cost) and wait. Read the context of a subject with `okb brain context <folder or note>` (parents\' 5-minute pages, children, linked concept cards). Facts go to the lowest level that holds them; lessons rise to the highest level where they stay true.');
  return lines.join('\n');
}
