const cds = require('@sap/cds');
const { computeTotal } = require('./lib/pricing');

const MAX_ITEMS = Number(process.env.ORDER_MAX_ITEMS || 50);

module.exports = class OrdersService extends cds.ApplicationService {
  async init() {
    const { Orders } = this.entities;
    const bp = await cds.connect.to('API_BUSINESS_PARTNER');

    // Every new order is checked before it is saved.
    this.before('CREATE', Orders, async (req) => {
      const items = req.data.items ?? [];
      if (items.length > MAX_ITEMS) return req.error(400, `An order has at most ${MAX_ITEMS} items`);
      req.data.total = computeTotal(items);
      const ok = await this.creditCheck(req.data.customer_ID, req.data.total, bp);
      if (!ok) return req.error(409, 'Credit limit exceeded');
    });

    this.on('cancelOrder', async (req) => {
      const { order, reason } = req.data;
      const n = await UPDATE(Orders, order).with({ status: 'CANCELLED' }).where({ status: { '!=': 'SHIPPED' } });
      if (!n) return req.error(409, 'Shipped orders cannot be cancelled');
      await this.emit('OrderCancelled', { order, reason });
    });

    return super.init();
  }

  // TODO: cache the business partner lookups (each order calls S/4HANA once)
  async creditCheck(customer, amount, bp) {
    const partner = await bp.run(SELECT.one.from('A_BusinessPartner').where({ BusinessPartner: customer }));
    return Boolean(partner) && amount <= Number(partner.CreditLimit ?? 0);
  }
};
