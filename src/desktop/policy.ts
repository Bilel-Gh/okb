import { delimiter, resolve } from 'node:path';
export function allowedNavigation(target: string, origin: string): boolean { try { return new URL(target).origin === new URL(origin).origin && new URL(target).protocol === 'http:'; } catch { return false; } }
export type UpdatePolicy = { enabled: false } | { enabled: true; stable: string; preview: string; publisher: string };
export function parseUpdatePolicy(raw: unknown): UpdatePolicy {
  if (!raw || typeof raw !== 'object') return { enabled: false };
  const value = raw as Record<string, unknown>;
  if (!value.stable && !value.preview) return { enabled: false };
  const checked = (v: unknown) => {
    if (typeof v !== 'string') throw new Error('Two pinned HTTPS update feeds are required');
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port) throw new Error('Updates require HTTPS without credentials, query, fragment or custom port');
    return u.href;
  };
  const stable = checked(value.stable); const preview = checked(value.preview);
  if (typeof value.publisher !== 'string' || !value.publisher.trim()) throw new Error('A signing publisher is required');
  return { enabled: true, stable, preview, publisher: value.publisher };
}
export function portableAgentPath(current: string | undefined, home: string, platform = process.platform): string {
  const common = platform === 'win32' ? [resolve(home, '.local', 'bin'), resolve(home, 'AppData', 'Roaming', 'npm')] : [resolve(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return [...new Set([...(current ?? '').split(delimiter).filter(Boolean), ...common])].join(delimiter);
}

/** Updates require the identity baked into the signed distribution, not just a feed URL. */
export function updateIdentityMatches(platform: string, publisher: string, metadata: { publisherNames?: unknown; authority?: string; signatureStatus?: string; certificatePublisher?: string }): boolean {
  if (platform === 'win32') {
    const names = typeof metadata.publisherNames === 'string' ? [metadata.publisherNames] : metadata.publisherNames;
    return metadata.signatureStatus === 'Valid' && metadata.certificatePublisher === publisher && Array.isArray(names) && names.length > 0 && names.every((name) => name === publisher);
  }
  if (platform === 'darwin') return metadata.authority === `Developer ID Application: ${publisher}` || Boolean(metadata.authority?.startsWith(`Developer ID Application: ${publisher} (`));
  return false;
}

/** One explicit manifest name on both sides, independent of alpha/rc/preview version suffixes. */
export function updateChannelFor(version: string): { channel: 'stable' | 'preview'; manifest: 'latest' | 'beta' } {
  return version.includes('-') ? { channel: 'preview', manifest: 'beta' } : { channel: 'stable', manifest: 'latest' };
}
