import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSandbox, type Sandbox } from './helpers/sandbox.js';
import { closeDbs } from '../src/state/db.js';
import { statePaths } from '../src/state/paths.js';
import { configureAssistant } from '../src/assistant/assistant.js';
import { completeLocalText } from '../src/assistant/bridge.js';
import { sendToAi } from '../src/ai/gate.js';
import * as provider from '../src/ai/provider.js';
import { OkbError } from '../src/util/errors.js';

vi.mock('../src/assistant/bridge.js', async (original) => ({ ...await original<typeof import('../src/assistant/bridge.js')>(), completeLocalText: vi.fn() }));
const boxes: Sandbox[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(completeLocalText).mockReset(); closeDbs(); await Promise.all(boxes.splice(0).map((b) => b.cleanup())); });
async function fixture() { const box = await makeSandbox({ profileId: 'local-gate', language: 'fr' }); boxes.push(box); return { box, config: await box.config() }; }
const out = { purpose: 'translate' as const, system: 'Translate only the supplied note.', prompt: 'Bonjour.', size: 'small' as const, maxTokens: 50 };

describe('Explicit local-agent choice for existing features', () => {
  it('routes translation through the chosen local bridge and preserves unknown usage as an estimate', async () => {
    const { box, config } = await fixture(); configureAssistant(config, 'claude-code');
    const legacy = vi.spyOn(provider, 'complete').mockRejectedValue(new Error('legacy transport must not run'));
    vi.mocked(completeLocalText).mockResolvedValue({ text: 'Hello.', provider: 'claude-code', tokens: { input: 18, output: 3 }, usage: { input: null, output: null }, usedTokens: null, estimated: true });
    const result = await sendToAi(config, out, { ...box.env, OKB_AI: '' });
    expect(result.usage).toEqual({ input: null, output: null }); expect(result.estimated).toBe(true);
    expect(legacy).not.toHaveBeenCalled(); expect(completeLocalText).toHaveBeenCalledWith(config, expect.anything(), out, 'claude-code');
    const line = JSON.parse((await readFile(resolve(statePaths(config).root, 'ai', 'usage.jsonl'), 'utf8')).trim());
    expect(line.estimated).toBe(true); expect(line.tokens).toBeGreaterThan(0);
  });
  it('does not fall back to an API or legacy CLI when the chosen local agent fails', async () => {
    const { box, config } = await fixture(); configureAssistant(config, 'codex');
    const legacy = vi.spyOn(provider, 'complete').mockRejectedValue(new Error('must not run'));
    vi.mocked(completeLocalText).mockRejectedValue(new OkbError('E_IO', 'fixture connection unavailable'));
    await expect(sendToAi(config, out, { ...box.env, OKB_AI: '' })).rejects.toMatchObject({ code: 'E_IO' });
    expect(legacy).not.toHaveBeenCalled(); expect(completeLocalText).toHaveBeenCalledWith(config, expect.anything(), out, 'codex');
  });
  it('checks secrets before the selected bridge receives any request', async () => {
    const { box, config } = await fixture(); configureAssistant(config, 'claude-code');
    await expect(sendToAi(config, { ...out, prompt: 'password=SuperSecret123!' }, { ...box.env, OKB_AI: '' })).rejects.toMatchObject({ code: 'E_SECRET' });
    expect(completeLocalText).not.toHaveBeenCalled();
  });
  it('keeps offline fake behavior even after choosing a local agent', async () => {
    const { box, config } = await fixture(); configureAssistant(config, 'claude-code');
    const result = await sendToAi(config, out, { ...box.env, OKB_AI: 'fake' });
    expect(result.provider).toBe('fake'); expect(result.text).toContain('[fake]'); expect(completeLocalText).not.toHaveBeenCalled();
  });
});
