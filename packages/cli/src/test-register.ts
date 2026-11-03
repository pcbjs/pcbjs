// `node --import @pcbjs/cli/test-register`: board tests in TypeScript run on Node 22.12 with no flag, the hooks of test-hooks.ts stripping the types.
import * as mod from 'node:module'
import { loadSync, resolveSync } from './test-hooks.js'

// registerHooks runs in this thread, from Node 22.15; register, its predecessor, in a thread of its own
const sync = (mod as { registerHooks?: (h: { resolve: typeof resolveSync; load: typeof loadSync }) => unknown }).registerHooks
if (sync) sync({ resolve: resolveSync, load: loadSync })
else mod.register(new URL('./test-hooks.js', import.meta.url))
