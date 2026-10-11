import type { OkbConfig } from '../config/schema.js';
import type { Bundle } from '../kb/bundle.js';
import type { NoteToRecheck } from '../projects/sources.js';
import { repoPlace } from '../brain/products.js';
import { gitIdentity } from '../repo/git.js';
import { repoNotes } from '../repo/notes.js';
import { listRepos } from '../repo/registry.js';
import { repoPaths } from '../repo/state.js';
import { freshness } from '../repo/status.js';

// Avoid rerunning the repository checks when Today is reopened unchanged.
// A dirty tree is rechecked every time; a committed HEAD or note edit invalidates immediately.
const cache = new Map<string, { bundle: Bundle; head: string | null; at: number; notes: NoteToRecheck[] }>();
export async function developerNotesToRecheck(config: OkbConfig, env: NodeJS.ProcessEnv, bundle: Bundle): Promise<NoteToRecheck[]> {
  const out: NoteToRecheck[] = [];
  const repos = (await listRepos(env)).filter((r) => r.kb === config.profile.id);
  for (const repo of repos) {
    const notes = repoNotes(bundle, repo.id, await repoPlace(config, repo));
    if (!notes.length) continue;
    const identity = await gitIdentity(repo.path);
    const key = `${config.stateHome}:${repo.path}`;
    const hit = cache.get(key);
    if (!identity.dirty && hit?.bundle === bundle && hit.head === identity.head && Date.now() - hit.at < 15_000) { out.push(...hit.notes); continue; }
    const result = await freshness({ config, repo, paths: repoPaths(config, repo.id) }, { bundle, notes, head: identity.head });
    const at = new Date().toISOString();
    const changed: NoteToRecheck[] = result.notes.filter((n) => n.verdict === 'changed' || n.verdict === 'stale').map((n) => ({ path: n.path, title: bundle.byPath.get(n.path)?.title ?? n.path, scope: repo.name, verdict: n.verdict as 'changed' | 'stale', files: n.files.map((f) => f.file), at, next: `okb repo update ${repo.id}` }));
    if (cache.size >= 30 && !cache.has(key)) cache.delete(cache.keys().next().value!);
    cache.set(key, { bundle, head: identity.head, at: Date.now(), notes: changed });
    out.push(...changed);
  }
  return out;
}
