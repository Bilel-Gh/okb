import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { cloudSyncedFolder } from '../src/repo/confidential.js';
import { mermaidNodes, locateQuote, resolveDossier } from '../src/repo/dossier.js';
import { landscapeEdges, proposeQuestionsNote, askWho } from '../src/repo/generated.js';
import { addFindings, recordAnswer, repoNotes, writeRepoNote } from '../src/repo/notes.js';
import { QUESTIONS } from '../src/repo/questions.js';
import { addRepo, listRepos, repoForDir, sameRemote } from '../src/repo/registry.js';
import { scanRepository } from '../src/repo/scan.js';
import { freshness, repoStatus } from '../src/repo/status.js';
import { loadProgress } from '../src/repo/state.js';
import { ticketContext } from '../src/repo/ticket.js';
import { suggestIntent } from '../src/routing/intent.js';
import { acquireUrl } from '../src/sources/registry.js';
import { makeSandbox, TEST_ROOT } from './helpers/sandbox.js';
import { approve, dirs, dossier, git, gitFixture, registered, sandboxes, useRepoSandboxes, workKb } from './helpers/repo.js';

useRepoSandboxes();

describe('repository scan', () => {
  it('maps a SAP CAP repository without running anything', async () => {
    const root = await gitFixture();
    const map = await scanRepository({ id: 'orders-service', name: 'orders-service', path: root });
    const stack = map.stack.map((s) => s.id);
    expect(stack.slice(0, 2)).toEqual(['sap-cap', 'express']);
    expect(stack).toEqual(expect.arrayContaining(['sap-mta', 'ui5', 'sap-xsuaa', 'sap-cloud-sdk', 'hana', 'jest', 'node']));
    expect(map.repo.description).toBe('Order management for the Acme web shop (SAP CAP).');
    expect(map.published.map((p) => p.name)).toContain('@acme/orders-service');

    const provided = map.provides.map((p) => `${p.kind}:${p.name}${p.detail ? `:${p.detail}` : ''}`);
    expect(provided).toEqual(expect.arrayContaining(['cds-service:OrdersService:path /orders', 'cds-service:AdminService:path /admin', 'cds-service:action cancelOrder:operation', 'event:OrderCancelled:declared event (CDS)', 'ui-app:acme.orders.ui:SAPUI5 / Fiori application', 'service-binding:srv-api:provided by module orders-srv']));
    const consumed = map.consumes.map((c) => `${c.kind}:${c.name}`);
    expect(consumed).toEqual(expect.arrayContaining(['external-service:API_BUSINESS_PARTNER', 'destination:S4_BP', 'destination:WAREHOUSE_API', 'service-binding:orders-xsuaa', 'url:warehouse.acme-internal.net', 'package:@acme/pricing-rules', 'odata:/orders/']));
    const bp = map.consumes.find((c) => c.name === 'API_BUSINESS_PARTNER')!;
    expect(bp.evidence).toMatchObject({ file: 'package.json' });
    expect(bp.detail).toContain('destination S4_BP');

    expect(map.env.map((e) => e.name)).toEqual(['NOTIFY_URL', 'ORDER_MAX_ITEMS']);
    expect(map.env.find((e) => e.name === 'ORDER_MAX_ITEMS')!.defaulted).toBe(true);
    expect(map.environments.map((e) => e.name)).toEqual(['dev', 'prod']);
    const orders = map.entities.find((e) => e.name === 'Orders')!;
    expect(orders.namespace).toBe('acme.orders');
    expect(orders.relations).toEqual(expect.arrayContaining([{ to: 'Customers', kind: 'association' }, { to: 'OrderItems', kind: 'composition' }]));
    expect(map.docs[0]!.path).toBe('README.md');
    expect(map.commands.find((c) => c.kind === 'start' && c.cwd === '.')!.run).toBe('npm start');
    expect(map.ci[0]).toMatchObject({ system: 'GitHub Actions', stages: ['test', 'deploy-dev'] });
    expect(map.ownership.codeowners.map((c) => c.pattern)).toEqual(['*', '/mta.yaml', '/.github/']);
    expect(map.ownership.authors.map((a) => a.name).sort()).toEqual(['Alice Martin', 'Bob Leroy']);
    expect(map.central.find((c) => c.path === 'srv/lib/pricing.js')!.importedBy).toBe(3);
  });

  it('flags documentation that disagrees with the repository and plans the reading', async () => {
    const root = await gitFixture();
    const map = await scanRepository({ id: 'orders-service', name: 'orders-service', path: root });
    const drift = map.risks.filter((r) => r.kind === 'doc-drift');
    expect(drift).toHaveLength(1);
    expect(drift[0]!.params).toMatchObject({ code: 'script', name: 'seed', doc: 'README.md' });
    expect(map.risks.some((r) => r.kind === 'todo' && r.params?.file === 'srv/orders-service.js')).toBe(true);
    const read = map.plan.read.map((i) => i.path);
    expect(read.slice(0, 1)).toEqual(['README.md']);
    expect(read).toEqual(expect.arrayContaining(['package.json', 'mta.yaml', 'srv/orders-service.cds', 'db/schema.cds', 'xs-security.json', '.github/workflows/ci.yml', 'docs/adr/0001-use-cap.md']));
    expect(map.plan.skim.map((i) => i.path)).toEqual(expect.arrayContaining(['srv/orders-service.js', 'srv/lib/pricing.js']));
    expect(map.questions).toHaveLength(QUESTIONS.length);
    expect(map.questions.find((q) => q.id === 'q-run-local')!.status).toBe('hinted');
  });

  it('never reads credential files beyond variable names', async () => {
    const root = await gitFixture();
    await writeFile(resolve(root, 'default-env.json'), JSON.stringify({ VCAP_SERVICES: { xsuaa: [{ credentials: { clientsecret: 'super-secret-value-123456' } }] } }));
    const map = await scanRepository({ id: 'orders-service', name: 'orders-service', path: root });
    expect(JSON.stringify(map)).not.toContain('super-secret-value-123456');
    expect(map.risks.some((r) => r.kind === 'tracked-env' && r.params?.file === 'default-env.json')).toBe(true);
    expect(map.plan.read.some((i) => i.path === 'default-env.json')).toBe(false);
  });
});

describe('repository registry', () => {
  it('finds a repository by path, then by remote after a fresh clone', async () => {
    const root = await gitFixture();
    const { s } = await workKb();
    git(root, 'remote', 'add', 'origin', 'https://bob:token123@github.example.com/acme/orders-service.git');
    const { repo } = await addRepo({ path: resolve(root, 'srv'), kb: 'travail' }, s.env);
    expect(repo).toMatchObject({ id: 'orders-service', path: root, remote: 'https://github.example.com/acme/orders-service.git' });
    expect((await repoForDir(resolve(root, 'db'), s.env))?.repo.id).toBe('orders-service');
    const clone = resolve(dirs[0]!, 'elsewhere');
    git(dirs[0]!, 'clone', '-q', root, clone);
    git(clone, 'remote', 'set-url', 'origin', 'git@github.example.com:acme/orders-service.git');
    const found = await repoForDir(clone, s.env);
    expect(found).toMatchObject({ moved: true, repo: { id: 'orders-service', path: clone } });
    expect(sameRemote('git@host:org/x.git', 'https://host/org/x')).toBe(true);
    expect(await listRepos(s.env)).toHaveLength(1);
  });
});

describe('repository dossier (version 3)', () => {
  it('locates quotes by lines and turns file citations into exact excerpts', async () => {
    const { config, repo, ctx } = await registered();
    const { resolved } = await resolveDossier(config, dossier(config), repo, [ctx.paths.dir]);
    expect(resolved.docs.map((d) => d.source.title)).toEqual(['orders-service/README.md', 'orders-service/package.json', 'orders-service/srv/orders-service.js']);
    const code = resolved.docs[2]!;
    expect(code.blocks).toHaveLength(1);
    expect(code.blocks[0]!.locator).toEqual({ kind: 'line', line: 23 });
    expect(resolved.coverage['README.md']).toBe('all');
    expect(resolved.notes[0]).toMatch(/^cites README\.md \(l\.3/);
    expect(locateQuote('a\nb\nc\nb', 'b', '4')).toEqual({ start: 4, end: 4, moved: false });
    expect(locateQuote('a\nb\nc', 'b', '3')).toEqual({ start: 2, end: 2, moved: true });
  });

  it('refuses a quote that is not in the file, a file outside the repository and loose diagram boxes', async () => {
    const { config, repo } = await registered();
    const bad = dossier(config);
    (bad.sections[0]!.claims[0]!.evidence[0] as { quote: string }).quote = 'Invented sentence';
    await expect(resolveDossier(config, bad, repo)).rejects.toMatchObject({ key: 'repoQuoteMissing' });
    const outside = dossier(config);
    (outside.sections[0]!.claims[0]!.evidence[0] as { file: string }).file = '../../etc/passwd';
    await expect(resolveDossier(config, outside, repo)).rejects.toMatchObject({ code: 'E_FORBIDDEN_PATH' });
    const diagram = (nodes: Record<string, string>) => dossier(config, {
      sections: [{ role: 'purpose', claims: [{ id: 'p', text: 'Le service gère les commandes.', kind: 'reported', evidence: [{ file: 'README.md', quote: 'Order management' }] }],
        aids: [{ type: 'diagram', mermaid: 'flowchart LR\n  UI[App] --> SRV[Service]\n  SRV --> BP[S4]', basedOn: ['p'], nodes }] }],
    });
    await expect(resolveDossier(config, diagram({ UI: 'app/orders/', SRV: 'srv/missing.js', BP: 'external:S4' }), repo)).rejects.toMatchObject({ key: 'repoDiagramNode' });
    await expect(resolveDossier(config, diagram({ UI: 'app/orders/', SRV: 'srv/orders-service.js' }), repo)).rejects.toMatchObject({ key: 'repoDiagramLoose' });
    const ok = await resolveDossier(config, diagram({ UI: 'app/orders/', SRV: 'srv/orders-service.js', BP: 'external:S4' }), repo);
    expect(JSON.stringify(ok.resolved.analysis)).not.toContain('"nodes"');
  });

  it('reads the boxes of flowcharts, sequence and ER diagrams', () => {
    expect(mermaidNodes('flowchart LR\n  UI[Fiori app] --> SRV[OrdersService]\n  SRV -->|OData| S4[S/4HANA BP]\n  SRV -- emits --> EM{{Event Mesh}}\n  A & B --> C:::hot')).toEqual(['UI', 'SRV', 'S4', 'EM', 'A', 'B', 'C']);
    expect(mermaidNodes('sequenceDiagram\n  participant U as User\n  U->>SRV: POST\n  SRV-->>DB: INSERT')).toEqual(['U', 'SRV', 'DB']);
    expect(mermaidNodes('erDiagram\n  Orders ||--o{ OrderItems : contains')).toEqual(['Orders', 'OrderItems']);
  });
});

describe('confidentiality and routing', () => {
  it('keeps a confidential KB off the web and spots synchronised folders', async () => {
    const { config } = await workKb();
    const confidential = { ...config, kb: { ...config.kb, confidential: true }, connectors: { ...config.connectors, web: { enabled: true, allowDomains: ['example.com'] } } };
    await expect(acquireUrl('https://example.com/page', confidential)).rejects.toMatchObject({ code: 'E_UNSUPPORTED' });
    const home = await mkdtemp(resolve(tmpdir(), 'okb-home-'));
    dirs.push(home);
    expect(cloudSyncedFolder(resolve(home, 'Documents', 'kb'), home)).toBeNull();
    await mkdir(resolve(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'), { recursive: true });
    expect(cloudSyncedFolder(resolve(home, 'Documents', 'kb'), home)).toBe('iCloud (Desktop & Documents)');
    expect(cloudSyncedFolder(resolve(home, 'Library', 'CloudStorage', 'OneDrive', 'kb'), home)).toMatch(/cloud storage/);
  });

  it('offers onboarding and the ticket follow-up from plain words', () => {
    const ctx = { kbs: [], otherTools: [] };
    expect(suggestIntent('je découvre ce repo, je n’y connais rien', ctx)?.command).toBe('/okb-dev:onboard');
    expect(suggestIntent("I'm new to this codebase", ctx)?.command).toBe('/okb-dev:onboard');
    expect(suggestIntent("ok j'ai fini mon ticket", ctx)?.command).toBe('/okb-dev:ticket');
    expect(suggestIntent('crée un nouveau repo pour ce projet', ctx)).toBeNull();
  });
});

