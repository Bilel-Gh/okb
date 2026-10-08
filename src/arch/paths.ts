/**
 * One spelling for an HTTP path, whoever wrote it: `/orders/:id`, `/orders/{orderId}/`,
 * `${BASE}/orders/${id}` and `https://host/orders/42?x=1` all become `/orders/{}` or `/orders/42`… minus
 * the base, the query and the trailing slash, so a call and a route can be matched.
 */
export function normalizePath(raw: string): string {
  let p = raw.trim().replace(/^['"`]|['"`]$/g, '');
  p = p.replace(/^[a-z]+:\/\/[^/]+/i, '');          // an origin
  p = p.replace(/^\$\{[^}]*\}/, '');                  // a base from a variable
  p = p.split(/[?#]/)[0] ?? '';
  p = p.replace(/\$\{[^}]*\}/g, '{}').replace(/:[A-Za-z_]\w*/g, '{}').replace(/\{[^}/]*\}/g, '{}').replace(/<[^>/]+>/g, '{}');
  p = p.replace(/\/+/g, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p.startsWith('/') ? p : `/${p}`;
}

/** The environment variable a base URL comes from: `process.env.ORDERS_URL`, `import.meta.env.VITE_ORDERS_URL`, or a constant set from one. */
export function baseVariable(expr: string, constants: ReadonlyMap<string, string>): string | null {
  const e = expr.trim();
  const env = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/.exec(e)?.[1];
  if (env) return env;
  const id = /^([A-Za-z_$][\w$]*)$/.exec(e)?.[1];
  if (id) return constants.get(id) ?? (/^[A-Z][A-Z0-9_]+$/.test(id) ? id : null);
  return null;
}

/** `const ORDERS = process.env.ORDERS_URL` and the like, in one file. */
export function envConstants(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) out.set(m[1]!, m[2]!);
  return out;
}
