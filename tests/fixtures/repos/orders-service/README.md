# Orders Service

Order management for the Acme web shop: customers place orders, the service checks
stock and credit with the business partner API, and the warehouse is notified when
an order is confirmed.

## Architecture

- `srv/` — the CAP service layer (OData V4 at `/orders`, admin API at `/admin`)
- `db/` — the data model (orders, items, products, customers)
- `app/orders/` — the Fiori elements app used by the sales team
- `app/router/` — the application router (login through XSUAA)

The service calls the S/4HANA business partner API through the destination `S4_BP`
and publishes `OrderCancelled` events to SAP Event Mesh.

## Getting started

Prerequisites: Node.js 20, the CAP CLI (`npm i -g @sap/cds-dk`) and access to the
BTP subaccount `acme-dev`.

```bash
npm ci
npm run seed
cds watch
```

The service starts on http://localhost:4004 with an in-memory SQLite database.

## Tests

```bash
npm test
```

## Deployment

The CI deploys `main` to the dev space. Production deployments are done by the
platform team with `cf deploy` on the MTA archive.

See `docs/adr/0001-use-cap.md` for why CAP was chosen.
