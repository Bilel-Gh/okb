import { writeFile, readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { OkbConfig } from '../config/schema.js';
import type { Acquired, NormalizedDoc } from './types.js';
import { sha256 } from '../util/hash.js';
import { ensureDir, writeJsonAtomic } from '../util/fsx.js';
import { asBundlePath, assertInsideRoot } from '../util/paths.js';
import { OkbError } from '../util/errors.js';

/** Optional acquired-byte archive, distinct from the working normalised snapshot. */
export async function retainAcquired(config: OkbConfig, acquired: Acquired, doc: NormalizedDoc): Promise<void> {
  if (config.sources.retention.mode !== 'copy') return;
  if (acquired.bytes.length > config.sources.retention.maxBytes) throw new OkbError('E_UNSUPPORTED', 'source exceeds retention.maxBytes; copy not retained');
  let bytes = acquired.bytes;
  if (config.sources.retention.redactPatterns.length) {
    if (doc.source.kind === 'pdf' || doc.source.kind === 'docx') throw new OkbError('E_UNSUPPORTED', 'binary source redaction is unsupported; choose reference retention');
    let text = Buffer.from(bytes).toString('utf8');
    try { for (const pattern of config.sources.retention.redactPatterns) text = text.replace(new RegExp(pattern,'g'),'[REDACTED]'); }
    catch (cause) { throw new OkbError('E_CONFIG','invalid retention redactPatterns regular expression',{cause}); }
    bytes = Buffer.from(text);
  }
  const artifactHash = sha256(bytes);
  const extension = /^\.[a-z0-9]{1,6}$/i.test(extname(acquired.filename ?? '')) ? extname(acquired.filename!).toLowerCase() : '.bin';
  const relative = asBundlePath(`${config.sources.retention.dir}/${artifactHash}${extension}`);
  await ensureDir(config.stateHome);
  await assertInsideRoot(config.stateHome,relative);
  const file = resolve(config.stateHome,relative);
  await ensureDir(resolve(file,'..'));
  try { await writeFile(file,bytes,{flag:'wx',mode:0o600}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (sha256(await readFile(file)) !== artifactHash) throw new OkbError('E_CONFLICT','retained source artifact changed');
  await writeJsonAtomic(`${file}.json`,{ sourceHash:doc.source.sha256,artifactHash,redacted:artifactHash!==doc.source.sha256,uri:doc.source.uri });
}
