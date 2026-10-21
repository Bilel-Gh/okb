import { afterEach, describe, expect, it } from 'vitest';
import { addAction, updateAction } from '../src/projects/actions.js';
import { closeDbs } from '../src/state/db.js';
import { nextStep } from '../src/work/ticket-next.js';
import { ticketId } from '../src/work/tickets.js';
import { demoBrain } from './helpers/brain.js';

afterEach(() => closeDbs());
const at = (m: number) => new Date(Date.UTC(2026, 9, 1, 0, m));

describe('the next step of a ticket is its first open todo (F2.4-13)', () => {
  it('pinned wins over importance', async () => {
    const { config } = await demoBrain();
    addAction(config, { text: 'haute', workRef: 'DEMO-1', importance: 'high' }, at(1));
    const pinned = addAction(config, { text: 'épinglée', workRef: 'DEMO-1', importance: 'low', pinned: true }, at(2));
    expect(nextStep(config, 'DEMO-1')?.id).toBe(pinned.id);
  });

  it('then the most important, then the oldest', async () => {
    const { config } = await demoBrain();
    addAction(config, { text: 'moyenne', workRef: 'DEMO-1' }, at(1));
    const old = addAction(config, { text: 'haute ancienne', workRef: 'DEMO-1', importance: 'high' }, at(2));
    addAction(config, { text: 'haute récente', workRef: 'DEMO-1', importance: 'high' }, at(3));
    expect(nextStep(config, 'DEMO-1')?.id).toBe(old.id);
  });

  it('is null without an open todo, and never a done one', async () => {
    const { config } = await demoBrain();
    expect(nextStep(config, 'DEMO-1')).toBeNull();
    const a = addAction(config, { text: 'faite', workRef: 'DEMO-1' });
    updateAction(config, a.id, { status: 'done' });
    expect(nextStep(config, 'DEMO-1')).toBeNull();
    addAction(config, { text: 'autre ticket', workRef: 'DEMO-2' });
    expect(nextStep(config, 'DEMO-1')).toBeNull();
  });

  it('normalises the reference', async () => {
    const { config } = await demoBrain();
    const a = addAction(config, { text: 'x', workRef: ticketId('demo_4211') });
    expect(nextStep(config, 'demo-4211')?.id).toBe(a.id);
  });
});
