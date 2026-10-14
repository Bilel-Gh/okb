#!/usr/bin/env node
import { createHook } from './runtime.mjs';
const hook = createHook(import.meta.url, 'SessionStart');
const input = await hook.read();
if (!input?.cwd) hook.finish('missing-cwd');
const out = await hook.run(['scope', '--context', '--cwd', String(input.cwd), '--json'], { cwd: String(input.cwd), json: true, timeout: 7000 });
hook.finish(out?.reason ?? 'no-context', typeof out?.context === 'string' ? out.context : '');
