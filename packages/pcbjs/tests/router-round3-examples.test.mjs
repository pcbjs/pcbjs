// The route cache on whole boards, each compiled in a copy of its example under the system's temporary directory: a cold
// compile and a warm one from the file it wrote give the same items, and usb3-hub, with the route file a reviewer's warm
// compile left with two crossing tracks in it, compiles without a short.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES = resolve(HERE, '../../../examples')

/** Copy an example without its generated files, let `prepare` change the copy, and compile it once per pass. */
async function compiled(example, passes, prepare = () => {}) {
  const { resolveConfig } = await import('@pcbjs/cli/config')
  const { pluginState } = await import('@pcbjs/cli/plugin')
  const { compileServer, compileSlots } = await import('@pcbjs/cli/check')
  const { clearRouteCache } = await import('@pcbjs/compile/route-cache')
  // the copy sits inside the repository's examples folder so that it resolves @pcbjs like the example does
  const dir = mkdtempSync(join(EXAMPLES, `.tmp-${example}-`))
  try {
    cpSync(join(EXAMPLES, example), dir, { recursive: true, filter: src => !/[\\/](\.pcbjs|shots|node_modules)$/.test(src) })
    prepare(dir)
    clearRouteCache()
    const cfg = await resolveConfig([], 'build', undefined, dir)
    const state = pluginState(cfg)
    const server = await compileServer(cfg, state, {})
    const out = []
    try {
      for (let i = 0; i < passes; i++) {
        // each pass reads the file the one before wrote, as a new process would
        clearRouteCache()
        for (const s of state.slots) s.compiled = undefined
        await compileSlots(server, cfg, state.slots, new Map())
        const errs = state.slots.flatMap(s => (s.error ? [s.error] : []))
        if (errs.length) throw errs[0]
        out.push(state.slots.flatMap(s => s.compiled ?? []).map(c => c.board))
      }
    } finally { await server.close() }
    return out
  } finally { clearRouteCache(); rmSync(dir, { recursive: true, force: true }) }
}

for (const example of ['usb3-hub', 'usb-hub', 'eth-phy']) {
  test(`examples/${example}: a cold compile and a warm one give the same items, every leg from the cache`, { timeout: 300000 }, async () => {
    const [cold, warm] = await compiled(example, 2)
    assert.ok(cold.length)
    cold.forEach((b, i) => {
      assert.equal(warm[i].routing.cached, warm[i].routing.legs, 'every leg from the cache')
      assert.deepEqual(warm[i].items, b.items)
      assert.deepEqual(warm[i].drc.map(d => d.message), b.drc.map(d => d.message))
      assert.deepEqual(b.drc.filter(d => d.severity === 'error').map(d => d.message), [])
    })
    if (example === 'usb3-hub') {
      // cold routes in about 5 s unloaded; the warm run beside it in this process is the baseline, so load scales both
      const { route: c } = cold[0].timings, { route: w } = warm[0].timings
      assert.ok(c < 60000, `cold route ${c} ms`)
      assert.ok(w < c / 3, `warm route ${w} ms against cold ${c} ms`)
    }
  })
}

test('examples/usb3-hub: the route file of a warm compile that reported a short between two cached tracks gives no short now', { timeout: 300000 }, async () => {
  const [[b]] = await compiled('usb3-hub', 1, dir => {
    cpSync(join(HERE, 'usb3-hub-short', 'pcb.tsx'), join(dir, 'pcb.tsx'))
    mkdirSync(join(dir, '.pcbjs', 'routes'), { recursive: true })
    cpSync(join(HERE, 'usb3-hub-short', 'routes-short.json'), join(dir, '.pcbjs', 'routes', 'usb3-hub.json'))
  })
  // the file stored P1/PWRCTL and P2/PWRCTL crossing at (67.65, 33.98), each with a hash that matched
  assert.deepEqual(b.drc.filter(d => d.rule === 'short' || d.rule === 'clearance').map(d => d.message), [])
  assert.ok(b.routing.cached > 0, 'the rest of the file is used')
})
