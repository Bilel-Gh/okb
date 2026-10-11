/**
 * Where the documents of a space live: files kept as they are (F2.0-10), in
 * one folder of the KB so they travel and are backed up with the notes. They
 * are never notes: reading the KB skips this folder.
 */
export const DOCUMENTS_DIR = '_Documents';

export function isDocumentPath(path: string): boolean {
  return path === DOCUMENTS_DIR || path.startsWith(`${DOCUMENTS_DIR}/`);
}
