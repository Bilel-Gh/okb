import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OkbConfig } from '../config/schema.js';
import { addEntry } from '../projects/journal.js';
import { getProject, listProjects, newId } from '../projects/projects.js';
import { extractSource } from '../sources/registry.js';
import { openDb, type Db } from '../state/db.js';
import { OkbError } from '../util/errors.js';
import { sha256 } from '../util/hash.js';
import { DOCUMENTS_DIR } from './place.js';

/**
 * A document (F2.0-10): a file the person keeps as it is — a PDF, a slide
 * deck, a mail, a photo. The file is copied once into the space's documents
 * folder and never changed; its text, when it can be read, is indexed for the
 * search; it can be tied to a project or a note. A document is not a note:
 * nothing obliges it to become one.
 */
export type Document = {
  readonly id: string;
  /** Where the file is, relative to the KB. */
  readonly path: string;
  readonly title: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
  readonly projectId: string | null;
  readonly notePath: string | null;
  readonly secret: boolean;
  /** Whether its text could be read (a photo or a recording is kept without text). */
  readonly textRead: boolean;
  readonly limitations: string;
  readonly addedAt: string;
};
export type DocumentHit = Document & { readonly snippet: string };

type Row = { id: string; path: string; title: string; mime: string; size: number; sha256: string; project_id: string | null; note_path: string | null; secret: number; text_read: number; limitations: string; added_at: string };
const COLUMNS = 'd.id, d.path, d.title, d.mime, d.size, d.sha256, d.project_id, d.note_path, d.secret, d.text_read, d.limitations, d.added_at';
const fromRow = (r: Row): Document => ({
  id: r.id, path: r.path, title: r.title, mime: r.mime, size: r.size, sha256: r.sha256, projectId: r.project_id, notePath: r.note_path,
  secret: r.secret === 1, textRead: r.text_read === 1, limitations: r.limitations, addedAt: r.added_at,
});

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain', '.html': 'text/html', '.htm': 'text/html', '.vtt': 'text/vtt', '.csv': 'text/csv', '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.eml': 'message/rfc822',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};
const MAX_TEXT = 2_000_000;

/** A file name that stays inside the documents folder, readable, on every system. */
function safeName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = base.normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'document';
}

async function freeName(dir: string, name: string): Promise<string> {
  const taken = new Set((await readdir(dir).catch(() => [] as string[])).map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 10_000; i++) if (!taken.has(`${stem}-${i}${ext}`.toLowerCase())) return `${stem}-${i}${ext}`;
  throw new OkbError('E_CONFLICT', `too many documents named ${name}`);
}

async function textOf(config: OkbConfig, bytes: Uint8Array, name: string): Promise<{ text: string; limitations: string }> {
  try {
    const doc = await extractSource({ uri: pathToFileURL(resolve('/', name)).href, bytes, filename: name }, config);
    const text = doc.blocks.map((b) => b.text).join('\n').slice(0, MAX_TEXT);
    return { text, limitations: doc.source.limitations.join(' ; ') };
  } catch (error) {
    // A photo, a recording, a format OKB does not read: kept all the same, found by its name.
    return { text: '', limitations: error instanceof OkbError ? error.message : 'text not read' };
  }
}

export function getDocument(config: OkbConfig, id: string): Document {
  const row = openDb(config).get<Row>(`SELECT ${COLUMNS} FROM documents d WHERE d.id = ?`, id);
  if (!row) throw new OkbError('E_NOT_FOUND', `no document "${id}"`, { key: 'documentUnknown', params: { id } });
  return fromRow(row);
}

export type NewDocument = { readonly name: string; readonly bytes: Uint8Array; readonly title?: string; readonly project?: string; readonly note?: string };

/** Keep a file: copied as it is, never over another one; the same file twice is kept once. */
export async function addDocument(config: OkbConfig, input: NewDocument, now = new Date()): Promise<{ document: Document; created: boolean }> {
  if (input.bytes.byteLength > config.sources.limits.maxBytes) {
    throw new OkbError('E_UNSUPPORTED', 'the file exceeds the size limit', { key: 'documentTooBig', params: { limit: Math.round(config.sources.limits.maxBytes / 1_000_000) }, hint: 'Raise sources.limits.maxBytes.' });
  }
  const db = openDb(config);
  const hash = sha256(input.bytes);
  const same = db.get<Row>(`SELECT ${COLUMNS} FROM documents d WHERE d.sha256 = ?`, hash);
  if (same) return { document: fromRow(same), created: false };
  const project = input.project ? getProject(config, input.project) : null;
  const name = safeName(input.name);
  const folder = posix.join(DOCUMENTS_DIR, String(now.getFullYear()));
  const dir = resolve(config.kb.root, folder);
  await mkdir(dir, { recursive: true });
  // A file already there with these very bytes and no entry is this one, kept just before a cut: it is taken as it is, not copied again.
  const there = await readFile(resolve(dir, name)).catch(() => null);
  const adopted = there !== null && sha256(there) === hash && !db.get<{ id: string }>('SELECT id FROM documents WHERE path = ?', posix.join(folder, name));
  const file = adopted ? name : await freeName(dir, name);
  // `wx`: never over an existing file, whatever happened between the listing and now.
  if (!adopted) await writeFile(resolve(dir, file), input.bytes, { flag: 'wx' });
  const title = (input.title?.trim() || file.slice(0, file.length - extname(file).length)).slice(0, 200);
  const { text, limitations } = await textOf(config, input.bytes, file);
  const id = newId('D');
  db.tx(() => {
    db.run('INSERT INTO documents (id, path, title, mime, size, sha256, project_id, note_path, text_read, limitations, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, posix.join(folder, file), title, MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', input.bytes.byteLength, hash, project?.id ?? null, input.note ?? null, text ? 1 : 0, limitations, now.toISOString());
    const rowid = db.get<{ n: number }>('SELECT rowid AS n FROM documents WHERE id = ?', id)!.n;
    db.run('INSERT INTO documents_fts (rowid, title, body) VALUES (?, ?, ?)', rowid, title, text);
    if (project) addEntry(config, { text: `📎 ${title}`, kind: 'note', project: project.id }, now);
  });
  return { document: getDocument(config, id), created: true };
}

/** Words of a question, as a full-text query: each word by its beginning, all of them, then any of them. */
function ftsQueries(query: string): string[] {
  const words = [...new Set(query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 12);
  if (!words.length) return [];
  const terms = words.map((w) => `"${w}"*`);
  return words.length > 1 ? [terms.join(' '), terms.join(' OR ')] : [terms[0]!];
}

function search(db: Db, query: string, limit: number): (Row & { snippet: string })[] {
  for (const q of ftsQueries(query)) {
    const rows = db.all<Row & { snippet: string }>(
      `SELECT ${COLUMNS}, snippet(documents_fts, 1, '', '', '…', 16) AS snippet FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?`, q, limit);
    if (rows.length) return rows;
  }
  return [];
}

export type DocumentFilter = { readonly project?: string; readonly query?: string; readonly limit?: number; readonly includeSecret?: boolean };

/** The documents: all of them, those of a project, or those a question finds (with the passage that matches). */
export async function listDocuments(config: OkbConfig, env: NodeJS.ProcessEnv, filter: DocumentFilter = {}): Promise<DocumentHit[]> {
  const db = openDb(config);
  const shown = new Set((await listProjects(config, env, { status: 'all' })).map((p) => p.id));
  const limit = filter.limit ?? 100;
  const rows: (Row & { snippet: string })[] = filter.query?.trim()
    ? search(db, filter.query, 200)
    : db.all<Row>(`SELECT ${COLUMNS} FROM documents d ORDER BY d.added_at DESC, d.rowid DESC`).map((r) => ({ ...r, snippet: '' }));
  return rows
    .filter((r) => (filter.includeSecret || r.secret === 0) && (!filter.project || r.project_id === filter.project))
    // A document of a project whose module is off stays listed, without its project.
    .map((r) => ({ ...fromRow(r), projectId: r.project_id && shown.has(r.project_id) ? r.project_id : null, snippet: r.snippet }))
    .slice(0, limit);
}

export type DocumentPatch = { readonly title?: string; readonly project?: string | null; readonly note?: string | null; readonly secret?: boolean };

export function updateDocument(config: OkbConfig, id: string, patch: DocumentPatch): Document {
  const db = openDb(config);
  return db.tx(() => {
    const before = getDocument(config, id);
    const project = patch.project ? getProject(config, patch.project).id : patch.project === null ? null : before.projectId;
    const title = patch.title?.trim() || before.title;
    db.run('UPDATE documents SET title = ?, project_id = ?, note_path = ?, secret = ? WHERE id = ?',
      title, project, patch.note === undefined ? before.notePath : patch.note, (patch.secret ?? before.secret) ? 1 : 0, id);
    if (title !== before.title) db.run('UPDATE documents_fts SET title = ? WHERE rowid = (SELECT rowid FROM documents WHERE id = ?)', title, id);
    return getDocument(config, id);
  });
}
