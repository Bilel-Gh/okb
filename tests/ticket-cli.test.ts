import { describe, expect, it } from 'vitest';
import { closeDbs } from '../src/state/db.js';
import { startTicket } from '../src/work/tickets.js';
import { addRepo } from '../src/repo/registry.js';
import { gitFixture, useRepoSandboxes, workKb } from './helpers/repo.js';
import { json } from './helpers/team.js';

useRepoSandboxes();
describe('the built terminal resumes work without AI (F2.4)', () => {
  it('keeps exact fields across terminal processes and guards closing by the required criteria', async () => {
    const { s, config } = await workKb();
    const path = await gitFixture();
    const { repo } = await addRepo({ path, kb: config.profile.id }, s.env);
    await startTicket(config, { ref: 'ORD-42', title: 'Exporter', repo });
    closeDbs();
    const call = (args: string[]) => json(['ticket', ...args, '--kb', config.profile.id, '--ticket', 'ORD-42'], s.env, path);
    const brief = await call(['brief', '--goal', 'Exporter sans doublons', '--last-action', 'Test pagination', '--next', 'Vérifier la CI']);
    expect(brief.brief).toMatchObject({ goal: 'Exporter sans doublons', lastAction: 'Test pagination', next: 'Vérifier la CI' });
    const state = await call(['state', 'delivery', 'deployed', '--environment', 'staging']);
    expect(state.detail.states.find((s: { dimension: string; environment: string }) => s.dimension === 'delivery' && s.environment === 'staging').status).toBe('deployed');
    expect(state.detail.states.find((s: { dimension: string; environment: string }) => s.dimension === 'delivery' && s.environment === 'production').status).toBe('unknown');
    const added = await call(['criterion', 'add', 'Export 100 lignes vérifié', '--kind', 'tests', '--required']);
    const criterion = added.detail.criteria.find((c: { text: string }) => c.text === 'Export 100 lignes vérifié');
    expect(criterion.required).toBe(true);
    const blocked = await call(['close']);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'E_CONFLICT', key: 'ticketCriteriaMissing' } });
    await call(['criterion', 'set', criterion.id, '--status', 'met']);
    const done = await call(['close']);
    expect(done.ticket.status).toBe('done');
    expect(done.detail.states.find((s: { dimension: string }) => s.dimension === 'checks').status).toBe('unknown');
    closeDbs();
  }, 45_000);

  it('fills the sheet, reports on a request and edits a todo from the terminal (F2.4-08..13)', async () => {
    const { s, config } = await workKb();
    const path = await gitFixture();
    const { repo } = await addRepo({ path, kb: config.profile.id }, s.env);
    await startTicket(config, { ref: 'ORD-50', repo });
    closeDbs();
    const run = (args: string[]) => json([...args, '--kb', config.profile.id], s.env, path);
    const set = await run(['ticket', 'set', 'ORD-50', '--field', 'team', '--value', 'Équipe Export', '--origin', 'jira', '--url', 'https://jira.example.com/browse/ORD-50']);
    // From the terminal the person writes as the person, whatever --origin says.
    expect(set.fields.team).toMatchObject({ value: 'Équipe Export', origin: 'person', manual: true });
    const asked = await run(['ticket', 'requests', 'add', 'ORD-50', '--fields', 'product']);
    const closed = await run(['ticket', 'requests', 'close', asked.id, '--found', 'product', '--read', 'jira']);
    expect(closed.state).toBe('done');
    await run(['ticket', 'rename', 'ORD-50', 'Exporter les commandes']);
    const todo = await run(['action', 'add', 'Tester le keyset', '--ticket', 'ord-50', '--importance', 'high']);
    expect(todo.action ?? todo).toMatchObject({ workRef: 'ORD-50', importance: 'high' });
    const id = (todo.action ?? todo).id;
    await run(['action', 'edit', id, '--text', 'Tester le keyset sur 1 000 lignes', '--pin']);
    const sheet = await run(['ticket', 'sheet', 'ORD-50']);
    expect(sheet).toMatchObject({ title: { value: 'Exporter les commandes' }, next: { text: 'Tester le keyset sur 1 000 lignes', pinned: true } });
    await run(['action', 'delete', id]);
    expect((await run(['ticket', 'sheet', 'ORD-50'])).next).toBeNull();
    closeDbs();
  }, 60_000);
});
