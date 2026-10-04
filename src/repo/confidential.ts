import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isInside } from '../kb/registry.js';
import { git } from './git.js';

/**
 * A KB about company code must stay on the machine: not in a folder a personal
 * cloud synchronises, not pushed to a personal remote. These checks only
 * report; moving a folder or removing a remote stays the person's decision.
 */
export function cloudSyncedFolder(path: string, home = homedir()): string | null {
  const abs = resolve(path);
  const candidates: [string, string][] = [
    [resolve(home, 'Library', 'Mobile Documents'), 'iCloud Drive'],
    [resolve(home, 'Library', 'CloudStorage'), 'cloud storage (OneDrive, Google Drive, Dropbox…)'],
    [resolve(home, 'Dropbox'), 'Dropbox'],
    [resolve(home, 'Google Drive'), 'Google Drive'],
    [resolve(home, 'OneDrive'), 'OneDrive'],
  ];
  // With "Desktop & Documents" turned on, iCloud synchronises these two folders in place.
  if (existsSync(resolve(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'))) candidates.push([resolve(home, 'Documents'), 'iCloud (Desktop & Documents)']);
  if (existsSync(resolve(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop'))) candidates.push([resolve(home, 'Desktop'), 'iCloud (Desktop & Documents)']);
  for (const [folder, label] of candidates) if (isInside(abs, folder)) return label;
  return null;
}

/** Remotes configured on the KB's own Git repository (names and sanitized URLs). */
export async function kbRemotes(root: string): Promise<string[]> {
  try {
    const out = await git(root, ['remote', '-v'], { timeout: 5000 });
    return [...new Set(out.split('\n').map((l) => l.split(/\s+/).slice(0, 2).join(' ')).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Where a new confidential KB goes by default: outside any synchronised folder. */
export function confidentialDefaultRoot(folder: string, preferredParent: string | null, home = homedir()): string {
  if (preferredParent && !cloudSyncedFolder(preferredParent, home)) return resolve(preferredParent, folder);
  return resolve(home, 'okb-travail', folder);
}
