import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDbs } from '../src/state/db.js';
import { serve } from '../src/web/server.js';
import { useRepoSandboxes, workKb } from './helpers/repo.js';
import { TEST_ROOT } from './helpers/sandbox.js';

useRepoSandboxes();
const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const s of stops.splice(0)) await s(); closeDbs(); });

describe('the app opens fast (F2.4-26)', () => {
  it('keeps the app’s versioned files in the browser cache, never the page itself', async () => {
    const assets = resolve(TEST_ROOT, '..', 'web', 'app', 'assets');
    const js = readdirSync(assets).find((f) => /-[\w-]{6,}\.js$/.test(f));
    expect(js).toBeTruthy();
    const { config, s } = await workKb();
    const started = await serve(config, { port: 0, env: s.env });
    stops.push(started.shutdown);
    const asset = await fetch(`${started.url}/app/assets/${js}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const page = await fetch(`${started.url}/`);
    expect(page.headers.get('cache-control')).toBe('no-store');
  });
});
