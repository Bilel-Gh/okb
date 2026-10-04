const { roundPrice } = require('@acme/pricing-rules');

/** Order total: quantity × price per item, rounded the shop's way. */
function computeTotal(items) {
  return roundPrice(items.reduce((sum, i) => sum + i.quantity * i.price, 0));
}

module.exports = { computeTotal };
