import { z } from 'zod';

/** An HTTPS address without credentials, query or fragment: what a ticket may point to. */
export const safeUrl = z.string().url().max(1500).refine((s) => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }, 'Use an HTTPS address without credentials or query parameters.');
