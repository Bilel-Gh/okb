#!/usr/bin/env node
import { createHook } from './runtime.mjs';
const hook = createHook(import.meta.url, 'SessionStart');
const input = await hook.read();
const cwd = typeof input?.cwd === 'string' ? input.cwd : undefined;
const [focus, brain] = await Promise.all([
  hook.run(['focus','--context'], {cwd,timeout:7000}),
  hook.run(['brain','session','--cwd',cwd || process.cwd()], {cwd,timeout:7000}),
]);
hook.finish('no-context', [focus,brain].filter((x)=>typeof x === 'string' && x).join('\n\n'));
