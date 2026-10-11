import { describe, expect, it } from 'vitest';
import { allowedNavigation, parseUpdatePolicy, portableAgentPath, updateChannelFor, updateIdentityMatches } from '../src/desktop/policy.js';

describe('Desktop security and distribution (F3.0)', () => {
  it('allows only the exact local app origin, never external navigation or a lookalike hostname', () => {
    expect(allowedNavigation('http://127.0.0.1:3210/#/projects', 'http://127.0.0.1:3210')).toBe(true);
    for (const url of ['https://127.0.0.1:3210/', 'http://127.0.0.1:3211/', 'http://127.0.0.1.evil.test:3210/', 'file:///tmp/private', 'javascript:alert(1)']) expect(allowedNavigation(url, 'http://127.0.0.1:3210')).toBe(false);
  });
  it('keeps updates disabled without a pinned HTTPS feed and publisher identity', () => {
    expect(parseUpdatePolicy({})).toEqual({ enabled: false });
    for (const url of ['http://updates.test/', 'https://user:pass@updates.test/', 'https://updates.test/?token=private', 'file:///tmp/feed']) expect(() => parseUpdatePolicy({ stable: url, preview: 'https://updates.test/preview/', publisher: 'OKB' })).toThrow();
    expect(parseUpdatePolicy({ stable: 'https://updates.test/stable/', preview: 'https://updates.test/preview/', publisher: 'OKB' })).toMatchObject({ enabled: true });
  });
  it('supports common native-agent install folders when launched from Finder without running a login shell', () => {
    const path = portableAgentPath('/usr/bin:/bin', '/fixture-user', 'darwin');
    expect(path).toContain('/fixture-user/.local/bin'); expect(path).toContain('/opt/homebrew/bin');
    expect(path).not.toContain('undefined');
  });
  it('refuses unsigned, missing or different update publishers', () => {
    expect(updateIdentityMatches('win32', 'OKB', { publisherNames: ['OKB'] })).toBe(false);
    expect(updateIdentityMatches('win32', 'OKB', { publisherNames: ['OKB'], signatureStatus: 'Valid', certificatePublisher: 'OKB' })).toBe(true);
    expect(updateIdentityMatches('win32', 'OKB', { publisherNames: ['OKB'], signatureStatus: 'NotSigned', certificatePublisher: 'OKB' })).toBe(false);
    expect(updateIdentityMatches('win32', 'OKB', { publisherNames: ['OKB'], signatureStatus: 'Valid', certificatePublisher: 'Other' })).toBe(false);
    expect(updateIdentityMatches('win32', 'OKB', { publisherNames: ['OKB', 'Other'] })).toBe(false);
    expect(updateIdentityMatches('win32', 'OKB', {})).toBe(false);
    expect(updateIdentityMatches('darwin', 'OKB', { authority: 'Developer ID Application: OKB (TEAM123)' })).toBe(true);
    expect(updateIdentityMatches('darwin', 'OKB', { authority: 'Developer ID Application: OKB Other (TEAM123)' })).toBe(false);
    expect(updateIdentityMatches('darwin', 'OKB', { authority: 'adhoc' })).toBe(false);
  });
  it('uses the same preview manifest for alpha, rc and preview versions without publishing a stable manifest', () => {
    expect(updateChannelFor('3.0.0')).toEqual({ channel: 'stable', manifest: 'latest' });
    for (const version of ['3.0.0-alpha.1', '3.0.0-rc.1', '3.0.0-preview.1']) expect(updateChannelFor(version)).toEqual({ channel: 'preview', manifest: 'beta' });
  });
});
