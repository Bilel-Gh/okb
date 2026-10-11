// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const moduleLoad = vi.hoisted(() => vi.fn());
vi.mock('../../web-app/src/pages/Assistant', () => {
  moduleLoad();
  return { AssistantChat: () => <p>Conversation chargée à la demande</p> };
});
import { AssistantPanel } from '../../web-app/src/ui/AssistantPanel.js';

afterEach(cleanup);
describe('the assistant stays out of the initial shell load', () => {
  it('does not import the conversation module until its panel is opened', async () => {
    render(<AssistantPanel context="Aujourd’hui" />);
    expect(moduleLoad).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le panneau Assistant' }));
    await screen.findByText('Conversation chargée à la demande');
    expect(moduleLoad).toHaveBeenCalledTimes(1);
  });
});
