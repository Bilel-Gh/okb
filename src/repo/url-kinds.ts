import { posix } from 'node:path';

/**
 * What an address written in a repository is (F2.4-15, D72). A URL in a file
 * is not a relation: a registry the build downloads from, where the code is
 * hosted, a wiki link in a comment or a font are not systems the application
 * talks to. Only a call (`call`) and an address a configuration key names
 * (`endpoint`) may become an outside resource on the map; everything else is
 * kept off the map, with its role, so nothing is lost.
 *
 * Pure and line-based where it can be: a map scanned before lot D only kept
 * the evidence line, and is classified from it alone.
 */
export type UrlRole = 'call' | 'endpoint' | 'registry' | 'source-host' | 'doc' | 'asset' | 'platform' | 'unknown';
export const URL_ROLES: readonly UrlRole[] = ['call', 'endpoint', 'registry', 'source-host', 'doc', 'asset', 'platform', 'unknown'];
/** The roles drawn on the map, as outside resources. */
export const ON_MAP: ReadonlySet<UrlRole> = new Set(['call', 'endpoint']);

const label = (words: string) => new RegExp(`(^|[.-])(${words})([.-]|$)`, 'i');
const REGISTRY_HOST = label('nexus|artifactory|jfrog|jcenter|registry|repo1|nuget|proget|verdaccio|pypi|npm|maven-repo|pkgs?');
const SOURCE_HOST = /(^|[.-])(github|gitlab|bitbucket|gitea|gogs|codeberg)([.-]|$)|(^|\.)dev\.azure\.com$|visualstudio\.com$/i;
const DOC_HOST = label('wiki|confluence|jira|atlassian|servicenow|service-now|sharepoint|notion|docs|documentation|readthedocs|intranet');
const ASSET_HOST = label('fonts|cdn|cdnjs|jsdelivr|unpkg|gravatar|static|assets|img|images');
const PLATFORM_HOST = label('eureka|consul|config-?server|zipkin|jaeger|prometheus|grafana|kibana|sonar|sonarqube|jenkins|argocd|vault|otel|splunk|datadog|newrelic|sentry');
const REGISTRY_FILES = /^(\.npmrc|\.yarnrc|\.yarnrc\.ya?ml|settings\.xml|pip\.conf|pip\.ini|\.pypirc|nuget\.config|\.condarc)$/i;

/** A call expression right before the address: `fetch('`, `axios.post(\``, `restTemplate.getForObject("`… */
const CALL = /(\bfetch|\baxios(?:\.\w+)?|\bgot(?:\.\w+)?|\bky(?:\.\w+)?|\bsuperagent\.\w+|\b(?:requests|httpx|session|client|http|https|urllib\.request)\.\w+|\b\w*[Rr]est[Tt]emplate\.\w+|\.uri|\bWebClient\.create|\bURI\.create|\bnew\s+URL|\burlopen|\bHttpGet|\bHttpPost|\$http\.\w+|this\.http\.\w+|\bopen)\s*\(\s*[fr]?[`'"]?\s*$|\b(curl|wget)\b[^|;&]*$/;
/** A key that names an address: `base-url: `, `"paymentsUrl": "`, `URL: `, `ENDPOINT=`. */
const ENDPOINT_KEY = /([\w.-]*(url|uri|endpoint|host|address|server|webhook|callback|target)[\w.-]*)["']?\s*[:=]\s*[`'"]?\s*$/i;
const DOC_KEY = /\b(homepage|documentation|docs|help|license|see|@see|@link|wiki)\b["']?\s*[:=]?\s*[`'"]?\s*$/i;

/** The part of the line before the address, with complete quoted strings removed. */
function lineBefore(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  return text.slice(start, index);
}
const unquoted = (s: string) => s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

function inComment(before: string): boolean {
  if (/^\s*(\/\/|#|\*|\/\*|<!--|--\s|;|rem\s)/i.test(before)) return true;
  const code = unquoted(before);
  return /(^|\s)\/\/|\/\*|<!--|(^|\s)#\s/.test(code);
}

/** True when the last opening of `open` before `index` is not closed by `close`. */
function insideXml(text: string, index: number, tags: string): boolean {
  const head = text.slice(0, index);
  let best = -1;
  for (const m of head.matchAll(new RegExp(`<(${tags})\\b[^>]*>`, 'gi'))) best = Math.max(best, m.index);
  if (best < 0) return false;
  const tag = /<([\w-]+)/.exec(head.slice(best))![1]!;
  return !new RegExp(`</${tag}\\s*>`, 'i').test(head.slice(best));
}

/** Inside `<!-- … -->`, over several lines. */
function inXmlComment(text: string, index: number): boolean {
  const head = text.slice(0, index);
  const open = head.lastIndexOf('<!--');
  return open >= 0 && !head.slice(open).includes('-->');
}

/** True when `index` sits inside the braces of the last block opened by `opener` (Gradle `repositories {`, JSON `"publishConfig": {`). */
function insideBlock(text: string, index: number, opener: RegExp): boolean {
  const head = text.slice(0, index);
  let at = -1;
  for (const m of head.matchAll(new RegExp(opener.source, 'g'))) at = m.index + m[0].length;
  if (at < 0) return false;
  let depth = 1;
  for (const c of head.slice(at)) { if (c === '{') depth++; else if (c === '}') depth--; if (depth === 0) return false; }
  return true;
}

export function classifyUrl(input: { readonly file: string; readonly text: string; readonly index: number; readonly host: string }): UrlRole {
  const { file, text, index } = input;
  const host = input.host.toLowerCase();
  const base = posix.basename(file).toLowerCase();
  const before = lineBefore(text, index);
  if (inComment(before) || inXmlComment(text, index)) return 'doc';
  // Where the build downloads from or publishes to.
  if (REGISTRY_FILES.test(base) || /^\s*@?[\w-]*:?registry\s*[=:]/i.test(before)) return 'registry';
  if (base === 'pom.xml' && insideXml(text, index, 'repositories|pluginRepositories|distributionManagement|mirrors|snapshotRepository')) return 'registry';
  if (/^(build|settings)\.gradle(\.kts)?$/.test(base) && insideBlock(text, index, /\b(repositories|pluginManagement)\s*\{/)) return 'registry';
  if (base === 'package.json' && (insideBlock(text, index, /"publishConfig"\s*:\s*\{/) || /"registry"\s*:\s*"$/.test(before))) return 'registry';
  // Where the code itself lives.
  if (base === 'pom.xml' && insideXml(text, index, 'scm')) return 'source-host';
  if (base === 'package.json' && (insideBlock(text, index, /"repository"\s*:\s*\{/) || /"(repository|bugs)"\s*:\s*"$/.test(before) || insideBlock(text, index, /"bugs"\s*:\s*\{/))) return 'source-host';
  if (CALL.test(before)) return 'call';
  if (REGISTRY_HOST.test(host)) return 'registry';
  if (SOURCE_HOST.test(host)) return 'source-host';
  if (DOC_KEY.test(before) || DOC_HOST.test(host)) return 'doc';
  if (ASSET_HOST.test(host)) return 'asset';
  if (PLATFORM_HOST.test(host)) return 'platform';
  if (ENDPOINT_KEY.test(before)) return 'endpoint';
  return 'unknown';
}
