import { resolve } from 'node:path';
import { z } from 'zod';
import { OkbError } from '../util/errors.js';
import { readJsonIfExists } from '../util/fsx.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';

export const MANIFEST = 'drawer.json';
export const drawerName = /^[a-z0-9][a-z0-9-]{1,39}$/;
const notePath = z.string().min(1).max(500).refine((path) => {
  try { return asBundlePath(path) === path && path.endsWith('.md') && !path.split('/').some((part) => part.startsWith('.')); }
  catch { return false; }
});
const schema = z.object({
  kind: z.literal('okb-drawer'), v: z.literal(1),
  person: z.object({ id: z.string().regex(/^p-[a-z0-9]{10}$/) }),
  name: z.string().min(1).max(200), updatedAt: z.string().datetime(),
  notes: z.array(z.object({ path: notePath, title: z.string().max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(10_000),
}).refine((m) => new Set(m.notes.map((n) => n.path)).size === m.notes.length);

export type DrawerManifest = z.infer<typeof schema>;

/** An invalid or symlinked drawer is unreadable; a writer must refuse it, never claim it as empty. */
export async function readManifest(folder: string, drawer: string, strict = false): Promise<DrawerManifest | null> {
  try {
    if (!drawerName.test(drawer)) throw new Error('invalid drawer name');
    await assertInsideRoot(folder, `${drawer}/${MANIFEST}`);
    const value = await readJsonIfExists<unknown>(resolve(folder, drawer, MANIFEST));
    if (value === null) return null;
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new Error('invalid drawer manifest');
    return parsed.data;
  } catch (cause) {
    if (!strict) return null;
    if (cause instanceof OkbError && cause.code === 'E_FORBIDDEN_PATH') throw cause;
    throw new OkbError('E_INVALID', 'the drawer manifest is invalid; inspect it before sending again', { key: 'shareManifestInvalid', params: { drawer }, cause });
  }
}
