import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBundleFor } from '../src/kb/bundle.js';
import { noteEvent } from '../src/scores/scores.js';
import { scoresFor } from '../src/scores/cached.js';
import { demoBrain } from './helpers/brain.js';

describe('the scores the web app shows (F2.0-35)', () => {
  it('follow a change to any note, not only the first fifty', async () => {
    const { config, kb } = await demoBrain({ tickets: 60 });
    const before = await loadBundleFor(config);
    expect(before.entries.length).toBeGreaterThan(55);
    const last = before.entries.at(-1)!;
    const scoreBefore = (await scoresFor(config, before)).get(last.path)!.global;
    await writeFile(resolve(kb, last.path), '---\ntitle: Vide\n---\n\nx\n');
    const after = await loadBundleFor(config);
    const scoreAfter = (await scoresFor(config, after)).get(last.path)!.global;
    expect(scoreAfter).not.toBe(scoreBefore);
  }, 120_000);

  it('follow what the person did with a note (opened, rated), not only its text', async () => {
    const { config } = await demoBrain();
    const bundle = await loadBundleFor(config);
    const note = bundle.entries.find((e) => !e.reserved)!;
    const before = (await scoresFor(config, bundle)).get(note.path)!.parts.value.opinion;
    await noteEvent(config, note.path, 'up');
    const after = (await scoresFor(config, await loadBundleFor(config))).get(note.path)!.parts.value.opinion;
    expect(after).toBeGreaterThan(before);
  }, 120_000);
});
