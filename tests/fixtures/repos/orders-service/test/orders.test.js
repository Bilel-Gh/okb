const { computeTotal } = require('../srv/lib/pricing');

describe('order total', () => {
  it('multiplies quantity by price', () => {
    expect(computeTotal([{ quantity: 2, price: 10 }])).toBe(20);
  });
});
