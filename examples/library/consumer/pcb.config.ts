import { defineConfig } from '@pcbjs/core'

// A consumer of the power library: install it, here as ../power/dist built by pcbjs build --lib, see library.md.
export default defineConfig({ entries: ['pcb.tsx'] })
