import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { addDocument, listDocuments, updateDocument } from '../../documents/documents.js';
import { OkbError } from '../../util/errors.js';
import { defineOperation, type OpContext } from '../operation.js';

const project = z.string().regex(/^P-[a-z0-9]{6}$/);
const id = z.string().regex(/^D-[a-z0-9]{6}$/);

/** Keeping or changing a document is the person's own act: an assistant searches them, nothing more. */
function personOnly(ctx: OpContext): void {
  if (ctx.actor !== 'person') throw new OkbError('E_NOT_APPROVED', 'only the person keeps or changes a document', { key: 'documentPersonOnly' });
}

export const documentsAdd = defineOperation({
  id: 'documents.add',
  module: 'core',
  effect: 'state',
  agents: false,
  summary: 'Keep a file as it is in the space (a PDF, a deck, a mail, a photo): from a path on this computer, or from its bytes.',
  input: z.object({
    file: z.string().min(1).max(2000).optional().describe('A path on this computer.'),
    name: z.string().min(1).max(300).optional(),
    data: z.string().max(60_000_000).optional().describe('The bytes, base64.'),
    title: z.string().trim().max(200).optional(),
    project: project.optional(),
    note: z.string().max(500).optional(),
  }).strict(),
  async run(ctx, input) {
    personOnly(ctx);
    if (!input.file && !(input.name && input.data !== undefined)) throw new OkbError('E_INVALID', 'a document needs a file, or a name and its bytes', { key: 'invalidInput', params: { field: 'file', problem: 'required' } });
    const bytes = input.file ? await readFile(resolve(input.file)).catch((cause) => { throw new OkbError('E_NOT_FOUND', `file not found: ${input.file}`, { cause, key: 'documentFileMissing', params: { file: basename(input.file!) } }); }) : Buffer.from(input.data!, 'base64');
    return addDocument(ctx.config, {
      name: input.name ?? basename(input.file!), bytes,
      ...(input.title ? { title: input.title } : {}), ...(input.project ? { project: input.project } : {}), ...(input.note ? { note: input.note } : {}),
    });
  },
});

export const documentsList = defineOperation({
  id: 'documents.list',
  module: 'core',
  effect: 'read',
  summary: 'The documents kept in the space (files as they are): all, those of a project, or those a question finds, with the passage that matches.',
  input: z.object({ project: project.optional(), query: z.string().max(300).optional(), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  async run({ config, env, actor }, input) {
    return { documents: await listDocuments(config, env, { ...input, includeSecret: actor === 'person' }) };
  },
});

export const documentsUpdate = defineOperation({
  id: 'documents.update',
  module: 'core',
  effect: 'state',
  agents: false,
  summary: 'Change a document: its title, its project, its note, or whether it is 🔒.',
  input: z.object({ id, title: z.string().trim().min(1).max(200).optional(), project: project.nullable().optional(), note: z.string().max(500).nullable().optional(), secret: z.boolean().optional() }).strict(),
  async run(ctx, input) {
    personOnly(ctx);
    const { id: documentId, ...patch } = input;
    return updateDocument(ctx.config, documentId, patch);
  },
});
