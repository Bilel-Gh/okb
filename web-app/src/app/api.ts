/**
 * The local server's API: GET with the chosen KB, POST with the session token.
 * Errors keep the server's own words for people (title, message, fix).
 */
export type Session = {
  token: string; ui: 'fr' | 'en'; version: string; active: string | null; outdated: boolean;
  kbs: { id: string; name: string; root: string; active: boolean; writingLanguage: string; exists: boolean; kind: string; brain: string | null }[];
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly title: string, message: string, readonly fix: string, readonly key: string | null = null) { super(message); }
}

let session: Session | null = null;
let kb: string | null = null;

export function setSession(s: Session, chosen: string | null): void { session = s; kb = chosen; }
export function currentKb(): string | null { return kb; }
export function currentSession(): Session | null { return session; }

async function read(r: Response): Promise<unknown> {
  const body = (await r.json().catch(() => ({}))) as { error?: string; key?: string; title?: string; message?: string; fix?: string };
  if (!r.ok) throw new ApiError(r.status, body.title ?? body.error ?? `HTTP ${r.status}`, body.message ?? body.error ?? '', body.fix ?? '', body.key ?? null);
  return body;
}

export async function get<T>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<T> {
  const q = new URLSearchParams();
  if (kb && !('kb' in params)) q.set('kb', kb);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const qs = q.toString();
  try {
    return (await read(await fetch(`${path}${qs ? `?${qs}` : ''}`, { cache: 'no-store' }))) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline', String((e as Error).message), '');
  }
}

export async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OKB-Token': session?.token ?? '' },
      body: JSON.stringify({ kb, ...body }),
    });
    return (await read(r)) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'offline', String((e as Error).message), '');
  }
}
