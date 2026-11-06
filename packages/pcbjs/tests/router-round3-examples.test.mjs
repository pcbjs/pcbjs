// A stale route cache containing crossing tracks must be rerouted to DRC-clean copper.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES = resolve(HERE, '../../../examples')

/** Copy an example without its generated files, let `prepare` change the copy, and compile it once per pass. */
async function compiled(example, passes, prepare = () => {}) {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer, compileSlots } = await import('@pcbjs/cli/internal/compile')
  const { viteLoader } = await import('@pcbjs/cli/internal/loader')
  const { clearRouteCache } = await import('@pcbjs/compile/internal/route-cache')
  const { clearStageCache } = await import('@pcbjs/compile/internal/cache')
  // the copy sits inside the repository's examples folder so that it resolves @pcbjs like the example does
  const dir = mkdtempSync(join(EXAMPLES, `.tmp-${example}-`))
  try {
    cpSync(join(EXAMPLES, example), dir, { recursive: true, filter: src => !/[\\/](\.pcbjs|shots|node_modules)$/.test(src) })
    prepare(dir)
    clearRouteCache()
    const cfg = await resolveConfig([], 'build', undefined, dir)
    const state = pluginState(cfg)
    const server = await compileServer(cfg)
    const out = []
    try {
      for (let i = 0; i < passes; i++) {
        // each pass reads the route file the one before wrote, as a new process would, and routes since no stage output is kept
        clearRouteCache()
        clearStageCache()
        for (const d of ['index', 'objects']) rmSync(join(dir, '.pcbjs', 'cache', d), { recursive: true, force: true })
        for (const s of state.slots) s.compiled = undefined
        await compileSlots(viteLoader(server), cfg, state.slots, new Map())
        const errs = state.slots.flatMap(s => (s.error ? [s.error] : []))
        if (errs.length) throw errs[0]
        out.push(state.slots.flatMap(s => s.compiled ?? []).map(c => c.board))
      }
    } finally {
      await server.close()
    }
    return out
  } finally {
    clearRouteCache()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('examples/usb3-hub: the route file of a warm compile that reported a short between two cached tracks gives no short now', { timeout: 300000 }, async () => {
  const [[b]] = await compiled('usb3-hub', 1, dir => {
    cpSync(join(HERE, 'usb3-hub-short', 'pcb.tsx'), join(dir, 'pcb.tsx'))
    mkdirSync(join(dir, '.pcbjs', 'cache', 'route'), { recursive: true })
    cpSync(join(HERE, 'usb3-hub-short', 'routes-short.json'), join(dir, '.pcbjs', 'cache', 'route', 'usb3-hub.json'))
  })
  // the file stored P1/PWRCTL and P2/PWRCTL crossing at (67.65, 33.98), each with a hash that matched; its keys predate ROUTER_VERSION maze-5, so it now reroutes
  assert.deepEqual(
    b.drc.filter(d => d.rule === 'short' || d.rule === 'clearance').map(d => d.message),
    [],
  )
})
