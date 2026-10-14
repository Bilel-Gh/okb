// Kept for compatible consumers; every OKB hook now uses the shared runtime.
import { resolveEngine } from './runtime.mjs';
export function okbPath() { return resolveEngine(import.meta.url)?.command ?? null; }
