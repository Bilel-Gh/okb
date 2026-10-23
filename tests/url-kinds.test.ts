import { describe, expect, it } from 'vitest';
import { classifyUrl, type UrlRole } from '../src/repo/url-kinds.js';
import { detectConsumes, detectProvides } from '../src/repo/interfaces.js';
import type { Inventory } from '../src/repo/inventory.js';

/** The role of the first URL in `text`, as the scan would see it in `file`. */
function role(file: string, text: string, host?: string): UrlRole {
  const m = /https?:\/\/([a-z0-9.-]+)/i.exec(text)!;
  return classifyUrl({ file, text, index: m.index, host: host ?? m[1]!.toLowerCase() });
}

/** A tiny inventory of in-memory files, enough for the detectors. */
function inventory(files: Record<string, string>, kinds: Record<string, string> = {}): Inventory {
  const kindOf = (path: string) => kinds[path] ?? (/\.(java|kt|js|ts|py)$/.test(path) ? 'source' : /(^|\/)(pom\.xml|package\.json|build\.gradle|mta\.yaml)$/.test(path) ? 'manifest' : 'config');
  return { root: '/fixture', fromGit: false, truncated: false, files: Object.keys(files).map((path) => ({ path, lang: null, kind: kindOf(path), bytes: files[path]!.length, lines: files[path]!.split('\n').length, tier: 'read', why: '' })), text: new Map(Object.entries(files)) } as unknown as Inventory;
}

describe('F2.4-15 · what an address written in the code is', () => {
  it('reads a comment as documentation, whatever the host', () => {
    expect(role('src/a.ts', '// see https://api.partner-pay.test/v2 for the contract')).toBe('doc');
    expect(role('src/a.py', 'x = 1  # https://api.partner-pay.test/v2')).toBe('doc');
    expect(role('src/A.java', ' * @see https://wiki.acme-corp.test/display/ORD')).toBe('doc');
    expect(role('pom.xml', '<!-- mirror: https://nexus.acme-corp.test/repo -->')).toBe('doc');
    expect(role('conf/app.properties', '# https://eureka.acme-corp.test:8761')).toBe('doc');
  });

  it('reads build registries from their file or their block', () => {
    expect(role('.npmrc', 'registry=https://pkgs.acme-corp.test/npm/')).toBe('registry');
    expect(role('settings.xml', '<url>https://pkgs.acme-corp.test/maven</url>')).toBe('registry');
    const pom = '<project>\n<repositories>\n  <repository>\n    <url>https://pkgs.acme-corp.test/maven-public/</url>\n  </repository>\n</repositories>\n<url>https://www.acme-corp.test/</url>\n</project>';
    expect(classifyUrl({ file: 'pom.xml', text: pom, index: pom.indexOf('https://pkgs'), host: 'pkgs.acme-corp.test' })).toBe('registry');
    expect(classifyUrl({ file: 'pom.xml', text: pom, index: pom.indexOf('https://www'), host: 'www.acme-corp.test' })).not.toBe('registry');
    const dist = '<distributionManagement>\n<repository><url>https://pkgs.acme-corp.test/releases</url></repository>\n</distributionManagement>';
    expect(classifyUrl({ file: 'pom.xml', text: dist, index: dist.indexOf('https://'), host: 'pkgs.acme-corp.test' })).toBe('registry');
    const gradle = 'repositories {\n  maven { url "https://pkgs.acme-corp.test/maven" }\n}\ndependencies {}';
    expect(classifyUrl({ file: 'build.gradle', text: gradle, index: gradle.indexOf('https://'), host: 'pkgs.acme-corp.test' })).toBe('registry');
    const pkg = '{\n  "publishConfig": {\n    "registry": "https://pkgs.acme-corp.test/npm-internal/"\n  }\n}';
    expect(classifyUrl({ file: 'package.json', text: pkg, index: pkg.indexOf('https://'), host: 'pkgs.acme-corp.test' })).toBe('registry');
    expect(role('build.gradle', 'maven { url "https://nexus.acme-corp.test/x" }')).toBe('registry');
    expect(role('pom.xml', '<url>https://jcenter.bintray.com</url>')).toBe('registry');
  });

  it('reads where the code is hosted, the documentation and page assets', () => {
    expect(role('pom.xml', '<scm><url>https://code.acme-corp.test/commerce/orders</url></scm>')).toBe('source-host');
    const pkg = '{ "repository": { "type": "git", "url": "https://code.acme-corp.test/commerce/stock.git" } }';
    expect(role('package.json', pkg)).toBe('source-host');
    expect(role('package.json', '"bugs": "https://code.acme-corp.test/commerce/stock/issues"')).toBe('source-host');
    expect(role('src/a.ts', "const u = 'https://github.acme-corp.test/commerce/x';")).toBe('source-host');
    expect(role('package.json', '"homepage": "https://intranet.acme-corp.test/stock"')).toBe('doc');
    expect(role('src/a.ts', "const page = 'https://wiki.acme-corp.test/display/STK';")).toBe('doc');
    expect(role('src/a.ts', "const page = 'https://jira.acme-corp.test/browse/ORD-1';")).toBe('doc');
    expect(role('src/api.ts', "export const font = 'https://fonts.googleapis.com/css2?family=Inter';")).toBe('asset');
    expect(role('src/api.ts', "export const cdn = 'https://cdn.jsdelivr.net/npm/chart.js';")).toBe('asset');
  });

  it('reads a call as a call and an address under a key as an endpoint', () => {
    expect(role('src/a.js', "fetch('https://hooks.chat-example.test/services/T0');")).toBe('call');
    expect(role('src/a.ts', 'await axios.post(`https://api.partner-pay.test/v2/charges`, body);')).toBe('call');
    expect(role('src/A.java', 'restTemplate.postForObject("https://api.partner-pay.test/v2/charges", o, C.class);')).toBe('call');
    expect(role('src/a.py', "requests.get('https://api.partner-pay.test/v2/rates')")).toBe('call');
    expect(role('src/main/resources/application.yml', '  base-url: https://api.partner-pay.test/v2')).toBe('endpoint');
    expect(role('mta.yaml', '                URL: https://orders.apps.acme-corp.test')).toBe('endpoint');
    expect(role('config/default.json', '"paymentsUrl": "https://api.partner-pay.test"')).toBe('endpoint');
    // A call wins over the host: a team that calls its Git host's API calls it.
    expect(role('src/a.ts', "fetch('https://github.acme-corp.test/api/v3/repos')")).toBe('call');
  });

  it('keeps the platform apart, and says when it does not know', () => {
    expect(role('src/main/resources/application.yml', '      defaultZone: http://eureka.acme-corp.test:8761/eureka/')).toBe('platform');
    expect(role('src/a.ts', "const x = 'https://sonar.acme-corp.test';")).toBe('platform');
    expect(role('src/a.ts', "const x = ['https://somewhere.acme-corp.test'];")).toBe('unknown');
  });

  it('classifies an old map from its evidence line alone', () => {
    // Before lot D a map stored only the line: no surrounding block, still no wrong « call ».
    expect(role('pom.xml', '<url>https://nexus.acme-corp.test/repository/maven-public/</url>')).toBe('registry');
    expect(role('src/A.java', ' * @see https://wiki.acme-corp.test/display/ORD/API')).toBe('doc');
  });
});

describe('F2.4-15 · the scan keeps each address with its role', () => {
  it('keeps one address seen in a comment and in a call as two findings', () => {
    const inv = inventory({ 'src/pay.js': "// docs: https://api.partner-pay.test/docs\nfetch('https://api.partner-pay.test/v2/charges', { method: 'POST' });\n" });
    const urls = detectConsumes(inv).filter((c) => c.kind === 'url');
    expect(urls.map((u) => `${u.name}:${u.role}`).sort()).toEqual(['api.partner-pay.test:call', 'api.partner-pay.test:doc']);
  });

  it('reads Spring mappings without parentheses and Kafka sends in Java', () => {
    const java = [
      '@RestController', '@RequestMapping("/orders")', 'public class OrderController {',
      '  @PostMapping', '  public Order create(Order o) { kafkaTemplate.send("order.created", o); return o; }',
      '  @GetMapping("/{id}")', '  public Order get(String id) { return null; }',
      '  @KafkaListener(topics = "stock.reserved")', '  public void on(String m) {}', '}',
    ].join('\n');
    const inv = inventory({ 'src/main/java/OrderController.java': java });
    const provides = detectProvides(inv).map((p) => `${p.kind}:${p.name}`);
    expect(provides).toEqual(expect.arrayContaining(['http-route:POST /orders', 'http-route:GET /orders/{id}', 'event:order.created']));
    expect(provides).not.toContain('event:stock.reserved');
    expect(detectConsumes(inv).map((c) => `${c.kind}:${c.name}`)).toContain('event:stock.reserved');
  });
});
