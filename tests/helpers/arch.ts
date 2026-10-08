import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { dirs } from './repo.js';
import { repo } from './team.js';

/**
 * A fictitious shop of five repositories whose architecture is known exactly
 * (tests/fixtures/arch/expected.json): a web shop calls the orders API, which
 * calls the payments API and publishes « order.created »; the shipping worker
 * listens to it and reads the order back; both APIs use a shared money library;
 * the orders API keeps its data in Postgres. Two traps: a call to an outside
 * geocoding service, and a call to « POST /refunds » nobody serves.
 */
export const SHOP: Record<string, Record<string, string>> = {
  'shop-web': {
    'package.json': JSON.stringify({ name: 'shop-web', private: true, description: 'Boutique en ligne : catalogue, panier et commande', dependencies: { react: '^18.3.1' } }, null, 2),
    'README.md': '# Boutique en ligne\n\nLe site où les clients passent commande.\n',
    'src/api.js': [
      "const ORDERS = import.meta.env.VITE_ORDERS_URL;",
      "export async function placeOrder(cart) {",
      "  const r = await fetch(`${ORDERS}/orders`, { method: 'POST', body: JSON.stringify(cart) });",
      "  return r.json();",
      "}",
      "export async function getOrder(id) {",
      "  return (await fetch(`${ORDERS}/orders/${id}`)).json();",
      "}",
      "export async function geocode(address) {",
      "  return fetch(`https://maps.example-geo.test/geocode?q=${address}`);",
      "}",
      "export async function askRefund(id) {",
      "  return fetch(`${ORDERS}/refunds`, { method: 'POST', body: JSON.stringify({ id }) });",
      "}",
      '',
    ].join('\n'),
  },
  'orders-api': {
    'package.json': JSON.stringify({ name: 'orders-api', private: true, description: 'Service des commandes', dependencies: { express: '^4.19.2', axios: '^1.7.2', kafkajs: '^2.2.4', pg: '^8.12.0', '@acme/money': '^1.2.0' } }, null, 2),
    'README.md': '# Service des commandes\n\nCrée et suit les commandes des clients.\n',
    'src/server.js': [
      "const express = require('express');",
      "const axios = require('axios');",
      "const { Kafka } = require('kafkajs');",
      "const { Pool } = require('pg');",
      "const app = express();",
      "const db = new Pool({ connectionString: process.env.DATABASE_URL });",
      "const producer = new Kafka({ brokers: [process.env.KAFKA_BROKER] }).producer();",
      "app.post('/orders', async (req, res) => {",
      "  const order = await db.query('insert into orders (total) values ($1) returning *', [req.body.total]);",
      "  await axios.post(`${process.env.PAYMENTS_URL}/payments`, { order: order.rows[0].id });",
      "  await producer.send({ topic: 'order.created', messages: [{ value: JSON.stringify(order.rows[0]) }] });",
      "  res.json(order.rows[0]);",
      "});",
      "app.get('/orders/:id', async (req, res) => res.json((await db.query('select * from orders where id = $1', [req.params.id])).rows[0]));",
      "app.post('/orders/:id/cancel', async (req, res) => res.json({ ok: true }));",
      "app.listen(3000);",
      '',
    ].join('\n'),
  },
  'payments-api': {
    'package.json': JSON.stringify({ name: 'payments-api', private: true, description: 'Service des paiements', dependencies: { express: '^4.19.2', '@acme/money': '^1.2.0' } }, null, 2),
    'README.md': '# Service des paiements\n\nEncaisse les commandes par carte.\n',
    'src/server.js': [
      "const express = require('express');",
      "const app = express();",
      "app.post('/payments', (req, res) => res.json({ status: 'paid' }));",
      "app.get('/payments/:id', (req, res) => res.json({ id: req.params.id }));",
      "app.listen(3001);",
      '',
    ].join('\n'),
  },
  'shipping-worker': {
    'package.json': JSON.stringify({ name: 'shipping-worker', private: true, description: 'Préparation des expéditions', dependencies: { kafkajs: '^2.2.4' } }, null, 2),
    'README.md': '# Expéditions\n\nPrépare les colis des commandes créées.\n',
    'src/worker.js': [
      "const { Kafka } = require('kafkajs');",
      "const consumer = new Kafka({ brokers: [process.env.KAFKA_BROKER] }).consumer({ groupId: 'shipping' });",
      "async function run() {",
      "  await consumer.subscribe({ topic: 'order.created' });",
      "  await consumer.run({ eachMessage: async ({ message }) => {",
      "    const order = JSON.parse(message.value);",
      "    const full = await fetch(`${process.env.ORDERS_URL}/orders/${order.id}`).then((r) => r.json());",
      "    console.log('ship', full.id);",
      "  } });",
      "}",
      "run();",
      '',
    ].join('\n'),
  },
  'money-lib': {
    'package.json': JSON.stringify({ name: '@acme/money', version: '1.2.0', description: 'Montants et devises partagés', main: 'index.js' }, null, 2),
    'README.md': '# Montants et devises\n\nBibliothèque partagée pour calculer les montants.\n',
    'index.js': "exports.cents = (euros) => Math.round(euros * 100);\n",
  },
};

/** Create the five repositories (Git) in a temporary folder; returns their entries. */
export async function shop(): Promise<{ id: string; name: string; path: string }[]> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-arch-')));
  dirs.push(root);
  const out: { id: string; name: string; path: string }[] = [];
  for (const [name, files] of Object.entries(SHOP)) {
    const path = resolve(root, name);
    await repo(path, files, `init ${name}`);
    out.push({ id: name, name, path });
  }
  return out;
}
