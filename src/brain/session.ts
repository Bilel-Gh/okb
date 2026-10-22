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
  if (config.changes.agentWrites === 'review-later') {
    // D71: the person chose « the agent files, I review later ».
    const { validatedShare } = await import('../review/state.js');
    const { openDb } = await import('../state/db.js');
    const share = await validatedShare(config, bundle).catch(() => null);
    const checks = openDb(config).all<{ id: string; path: string }>("SELECT id, path FROM note_requests WHERE kind = 'check' AND state = 'pending' ORDER BY created_at");
    lines.push('', `Notes to review by the person: ${share?.pending ?? 0}${share?.share !== null && share?.share !== undefined ? ` (memory ${share.share} % validated)` : ''}.${checks.length ? ` Checks asked: ${checks.map((c) => `${c.path} [${c.id}]`).join(', ')} — confront each with its sources, then propose the fixes.` : ''}`);
    lines.push('Notes: this KB files the agent\'s notes at once, « to review »; a note the person asked for is their yes: no suggestion card; prepare it as usual, then `okb keep <proposal> --json` and say in one line « Note rangée, déjà utilisable : <title> · <place> · Ouvrir dans OKB »' + (config.review.offer ? ', then offer a check against the sources in one line' : '') + '. A change to a validated note waits for their yes. You never validate, reject or approve a note, and never change this setting. A note you would add on your own still gets a suggestion card first.');
  } else lines.push('', 'Notes: never write one without the person\'s yes. Before writing, show a suggestion card (type, exact place from `okb where <type> --title … --product … --repo …`, why, notes that already cover it from `okb ask`, estimated cost) and wait.');
  lines.push('Read the context of a subject with `okb brain context <folder or note>` (parents\' 5-minute pages, children, linked concept cards). Facts go to the lowest level that holds them; lessons rise to the highest level where they stay true.');
  return lines.join('\n');
}
