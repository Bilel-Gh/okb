const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { computeTotal } = require('./lib/pricing');

/** Tell the warehouse an order is confirmed. */
async function notifyWarehouse(order) {
  const url = process.env.NOTIFY_URL;
  return executeHttpRequest({ destinationName: 'WAREHOUSE_API' }, { method: 'post', url: url ?? '/notifications', data: { order: order.ID, total: computeTotal(order.items) } });
}

module.exports = { notifyWarehouse };
