import { describe, expect, it } from 'vitest';
import { detectConsumes } from '../src/repo/interfaces.js';
import type { Inventory } from '../src/repo/inventory.js';
function calls(text: string) {
  const path = 'src/client.ts';
  const inv: Inventory = { root: '/fixture', fromGit: false, truncated: false, text: new Map([[path, text]]), files: [{ path, kind: 'source', bytes: text.length, lines: 5, lang: 'TypeScript', tier: 'read', why: '', area: 'src' }] };
  return detectConsumes(inv).filter((c) => c.kind === 'http-call');
}
describe('HTTP scan distinguishes defaults from unknown options', () => {
  it('does not guess GET for dynamic methods, variable options or spread options', () => {
    const found = calls("fetch('/dynamic', { method: chosen });\nfetch('/options', options);\nfetch('/spread', { ...options });\nfetch('/default');\nfetch('/post', { method: 'POST' });\nfetch('/override', { method: 'POST', ...options });");
    expect(found.map((c) => c.name)).toEqual(['ANY /dynamic', 'ANY /options', 'ANY /spread', 'GET /default', 'POST /post', 'ANY /override']);
    expect(found[0]?.evidence.line).toBe(1);
  });
});


describe('nested fetch options', () => {
  it('reads only a top-level method after nested headers and ignores a nested payload method', () => {
    const found = calls("fetch('/post', { headers: { 'X-Trace': 'x' }, method: 'POST' });\nfetch('/get', { body: { method: 'DELETE' } });\nfetch('/quoted', { \"method\": 'PATCH' });");
    expect(found.map((c) => c.name)).toEqual(['POST /post', 'GET /get', 'PATCH /quoted']);
  });
});
