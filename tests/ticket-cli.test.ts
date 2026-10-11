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
});
