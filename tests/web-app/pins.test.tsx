// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPinned, removeView, saveView, togglePin, usePins, useSavedViews } from '../../web-app/src/app/pins.js';

function Pins() {
  const pins = usePins();
  const views = useSavedViews();
  return <p>{pins.map((p) => p.title).join(',')}|{views.map((v) => `${v.name}:${JSON.stringify(v.query)}`).join(',')}</p>;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('pinned notes and saved views', () => {
  it('pins a note at the top, unpins it, and every reader of the list follows', () => {
    render(<Pins />);
    act(() => { togglePin({ path: 'a.md', title: 'A' }); togglePin({ path: 'b.md', title: 'B' }); });
    expect(screen.getByText(/\|/).textContent).toBe('B,A|');
    act(() => { expect(togglePin({ path: 'a.md', title: 'A' })).toBe(false); });
    expect(screen.getByText(/\|/).textContent).toBe('B|');
    expect(isPinned([{ path: 'b.md', title: 'B' }], 'b.md')).toBe(true);
  });

  it('saves a view under a name without its empty filters, and removes it', () => {
    render(<Pins />);
    act(() => { saveView('  Brouillons du mois ', { status: 'draft', since: '30d', cat: '' }); });
    expect(screen.getByText(/\|/).textContent).toBe('|Brouillons du mois:{"status":"draft","since":"30d"}');
    const id = (JSON.parse(localStorage.getItem('okb-brain-views')!) as { id: string }[])[0]!.id;
    act(() => { removeView(id); });
    expect(screen.getByText(/\|/).textContent).toBe('|');
  });
});
