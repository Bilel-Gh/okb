import { describe, expect, it } from 'vitest';
import { exploreMap, initialFocus } from '../../web-app/src/pages/arch-exploration.js';
import { architectureFixture } from '../helpers/arch-visual.js';

describe('progressive architecture exploration preserves the complete model', () => {
  it('opens a bounded context and names every hidden group and relation', () => {
    const model = architectureFixture('dense').model;
    const focus = initialFocus(model.nodes, model.links);
    const shown = exploreMap({ boxes: model.nodes, arrows: model.links }, { focus });
    expect(shown.boxes.length).toBeLessThanOrEqual(8);
    expect(shown.boxes.map((b) => b.id)).toContain(focus);
    expect(shown.boxes.length + shown.hidden.length).toBe(model.nodes.length);
    expect(shown.arrows.length + shown.hiddenRelations).toBe(model.links.length);
    expect(shown.groups.flatMap((g) => g.members).length).toBe(shown.hidden.length);
  });
  it('expands every dependency and never changes an endpoint, confidence or evidence', () => {
    const model = architectureFixture('dense').model;
    const shown = exploreMap({ boxes: model.nodes, arrows: model.links }, { expanded: model.nodes.map((b) => b.id) });
    expect(shown.arrows).toEqual(model.links);
    expect(shown.hiddenRelations).toBe(0);
    expect(shown.hidden).toHaveLength(0);
  });
  it('includes incoming neighbours, cycles and a shared database without duplicating a node', () => {
    const model = architectureFixture('cycle').model;
    const shown = exploreMap({ boxes: model.nodes, arrows: model.links }, { focus: 'repo:orders' });
    expect(shown.boxes.map((b) => b.id).sort()).toEqual(['repo:front', 'repo:orders', 'repo:shipping', 'store:shared'].sort());
    expect(shown.boxes.filter((b) => b.id === 'store:shared')).toHaveLength(1);
  });
});
