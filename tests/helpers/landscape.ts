import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { dirs } from './repo.js';
import { repo } from './team.js';

/**
 * Five fictitious repositories that look like a company landscape (F2.4-15):
 * what is written in them is what every real repository carries — a package
 * registry in pom.xml, .npmrc and build.gradle, jcenter, the internal Git host,
 * wiki and issue-tracker links in comments, a font and a CDN in the front — and
 * only two real outside resources: a payment partner and a chat webhook.
 * The relations between them are known exactly (see tests/arch-landscape.test.ts).
 */
export const LANDSCAPE: Record<string, Record<string, string>> = {
  'orders-api': {
    'README.md': '# Service des commandes\n\nBackend des commandes. Voir https://wiki.acme-corp.test/display/ORD/Accueil.\n',
    'pom.xml': [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      '  <groupId>com.acme</groupId><artifactId>orders-api</artifactId>',
      '  <scm><url>https://github.acme-corp.test/commerce/orders-api</url></scm>',
      '  <repositories>',
      '    <repository><id>internal</id><url>https://nexus.acme-corp.test/repository/maven-public/</url></repository>',
      '    <repository><id>jcenter</id><url>https://jcenter.bintray.com</url></repository>',
      '  </repositories>',
      '  <distributionManagement><repository><url>https://nexus.acme-corp.test/repository/releases/</url></repository></distributionManagement>',
      '</project>',
      '',
    ].join('\n'),
    'src/main/resources/application.yml': [
      'server:', '  port: 8080', 'eureka:', '  client:', '    serviceUrl:', '      defaultZone: http://eureka.acme-corp.test:8761/eureka/',
      'payment:', '  base-url: https://api.partner-pay.test/v2', 'stock:', '  url: ${STOCK_URL:http://localhost:8081}', '',
    ].join('\n'),
    'src/main/java/com/acme/orders/OrderController.java': [
      'package com.acme.orders;',
      '/**',
      ' * Contrôleur des commandes.',
      ' * @see https://wiki.acme-corp.test/display/ORD/API+commandes',
      ' * Ticket d\'origine : https://jira.acme-corp.test/browse/ORD-142',
      ' */',
      '@RestController',
      '@RequestMapping("/orders")',
      'public class OrderController {',
      '  @PostMapping',
      '  public Order create(Order o) {',
      '    restTemplate.postForObject("https://api.partner-pay.test/v2/charges", o, Charge.class);',
      '    restTemplate.getForObject("http://localhost:8081/stock/{sku}", Stock.class, o.sku);',
      '    kafkaTemplate.send("order.created", o);',
      '    return o;',
      '  }',
      '  @GetMapping("/{id}")',
      '  public Order get(String id) { return null; }',
      '}',
      '',
    ].join('\n'),
    'src/main/java/com/acme/orders/StockClient.java': 'package com.acme.orders;\n@FeignClient(name = "stock-service")\npublic interface StockClient {}\n',
    'src/test/java/OrderControllerTest.java': 'class OrderControllerTest { String u = "https://mock.acme-corp.test/orders"; }\n',
  },
  'stock-service': {
    'package.json': JSON.stringify({ name: 'stock-service', description: 'Service des stocks', repository: { type: 'git', url: 'https://github.acme-corp.test/commerce/stock-service.git' }, homepage: 'https://wiki.acme-corp.test/display/STK', publishConfig: { registry: 'https://nexus.acme-corp.test/repository/npm-internal/' }, dependencies: { '@acme/money': '^2.0.0', express: '^4.19.2' } }, null, 2),
    '.npmrc': 'registry=https://nexus.acme-corp.test/repository/npm-group/\n@acme:registry=https://nexus.acme-corp.test/repository/npm-internal/\n',
    'src/server.js': [
      '// Docs : https://wiki.acme-corp.test/display/STK/Architecture',
      "const app = require('express')();",
      "app.get('/stock/:sku', (req, res) => res.json({}));",
      "consumer.subscribe({ topic: 'order.created' });",
      '// TODO voir https://github.acme-corp.test/commerce/stock-service/issues/12',
      "fetch('https://hooks.chat-example.test/services/T000/B000', { method: 'POST' });",
      '',
    ].join('\n'),
  },
  'shop-web': {
    'package.json': JSON.stringify({ name: 'shop-web', description: 'Boutique web', dependencies: { '@acme/money': '^2.0.0', react: '^18.3.1' } }, null, 2),
    'vite.config.ts': "// https://vitejs.dev/config/\nexport default { server: { proxy: { '/api': 'http://localhost:8080' } } };\n",
    'src/api.ts': [
      'const ORDERS = import.meta.env.VITE_ORDERS_URL;',
      "export const create = (o: unknown) => fetch(`${ORDERS}/orders`, { method: 'POST', body: JSON.stringify(o) });",
      "export const font = 'https://fonts.googleapis.com/css2?family=Inter';",
      "export const cdn = 'https://cdn.jsdelivr.net/npm/chart.js';",
      '',
    ].join('\n'),
  },
  'money-lib': {
    'package.json': JSON.stringify({ name: '@acme/money', version: '2.1.0', description: 'Montants partagés', publishConfig: { registry: 'https://nexus.acme-corp.test/repository/npm-internal/' } }, null, 2),
    'build.gradle': 'repositories {\n  jcenter()\n  maven { url "https://nexus.acme-corp.test/repository/maven-public/" }\n}\n',
    'src/index.ts': '// Taux : https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml (lu par le service des taux, pas ici)\nexport const round = (n: number) => Math.round(n * 100) / 100;\n',
  },
  'billing-cap': {
    'package.json': JSON.stringify({ name: 'billing-cap', description: 'Facturation', cds: { requires: { db: { kind: 'hana' }, OrdersService: { kind: 'odata', credentials: { destination: 'orders-dest', url: 'https://orders.apps.acme-corp.test' } } } } }, null, 2),
    'mta.yaml': [
      'ID: billing-cap', 'modules:', '  - name: billing-srv', 'resources:', '  - name: billing-destination', '    parameters:', '      service: destination',
      '      config:', '        init_data:', '          instance:', '            destinations:', '              - Name: orders-dest', '                URL: https://orders.apps.acme-corp.test', '',
    ].join('\n'),
    'srv/billing.cds': "service BillingService @(path: '/billing') { action bill(); }\n",
    'srv/billing.js': "module.exports = async () => { const orders = await cds.connect.to('OrdersService'); return orders; };\n",
  },
};

/** Create the five repositories (Git) in a temporary folder. */
export async function landscape(): Promise<{ id: string; name: string; path: string }[]> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'okb-landscape-')));
  dirs.push(root);
  const out: { id: string; name: string; path: string }[] = [];
  for (const [name, files] of Object.entries(LANDSCAPE)) {
    const path = resolve(root, name);
    await repo(path, files, `init ${name}`);
    out.push({ id: name, name, path });
  }
  return out;
}
