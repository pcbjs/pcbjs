// The cancel contract measured: in a cold compile of usb3-hub every stage loop pulses, so no gap between two pulses takes 50 ms of
// this thread's CPU outside the units a pulse cannot split. Vite's evaluation and the GLB raster run outside this compile.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXAMPLES = resolve(HERE, '../../../examples')
const BOUND = 50

/** The compile frames of a pulse's stack as `function file:line`, the pulse itself left out. */
const where = e =>
  e.stack
    .split('\n')
    .filter(l => /[\\/]compile[\\/]dist[\\/]/.test(l) && !/cancel\.js/.test(l))
    .map(l => l.replace(/^\s*at (\S+) .*[\\/]dist[\\/](.*?):\d+\)?$/, '$1 $2'))

/** The units one pulse cannot split, by the pulses around them. */
const UNITS = {
  // the Clipper construction of one pour's fill
  'pour fill': (from, to) => from.startsWith('fillZones '),
}
const unitOf = g => Object.keys(UNITS).find(k => UNITS[k](where(g.from)[0] ?? '', where(g.to)[0] ?? ''))

test('cancel: no gap between pulses in a cold usb3-hub compile takes 50 ms outside a named unit', { timeout: 300000 }, async t => {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer } = await import('@pcbjs/cli/internal/compile')
  const { compileStages } = await import('@pcbjs/compile')
  const { pulsed } = await import('@pcbjs/compile/internal/cancel')
  const { clearRouteCache } = await import('@pcbjs/compile/internal/route-cache')
  const dir = mkdtempSync(join(EXAMPLES, '.tmp-gaps-'))
  try {
    cpSync(join(EXAMPLES, 'usb3-hub'), dir, { recursive: true, filter: src => !/[\\/](\.pcbjs|shots|node_modules)$/.test(src) })
    const cfg = await resolveConfig([], 'build', undefined, dir)
    const server = await compileServer(cfg)
    let root
    try {
      root = (await server.ssrLoadModule(join(dir, 'pcb.tsx'))).default
    } finally {
      await server.close()
    }
    clearRouteCache()
    const gaps = []
    let prev = new Error()
    // this thread's CPU time, so the other processes of a loaded machine do not count as the compile's
    const cpuMs = () => {
      const u = process.threadCpuUsage()
      return (u.user + u.system) / 1000
    }
    let last = cpuMs()
    const limit = Error.stackTraceLimit
    Error.stackTraceLimit = 5
    try {
      pulsed(
        () => {},
        () => compileStages(root, { cache: false, plugins: cfg.plugins }),
        wall => {
          const ms = cpuMs() - last
          const at = new Error()
          if (ms > BOUND / 2) gaps.push({ ms, wall, from: prev, to: at })
          prev = at
          last = cpuMs()
        },
      )
    } finally {
      Error.stackTraceLimit = limit
    }
    const show = g =>
      `${g.ms.toFixed(1)} ms, ${g.wall.toFixed(1)} wall, from ${where(g.from).slice(0, 3).join(' < ') || 'start'} to ${where(g.to).slice(0, 3).join(' < ') || 'end'}`
    const longest = gs => gs.sort((a, b) => b.ms - a.ms)
    const open = longest(gaps.filter(g => !unitOf(g)))
    t.diagnostic(`longest open gaps: ${open.slice(0, 5).map(show).join('; ') || `none over ${BOUND / 2} ms`}`)
    for (const k of Object.keys(UNITS))
      t.diagnostic(
        `longest ${k}: ${
          longest(gaps.filter(g => unitOf(g) === k))
            .slice(0, 2)
            .map(show)
            .join('; ') || 'none'
        }`,
      )
    assert.ok(!open.length || open[0].ms < BOUND, open.length ? show(open[0]) : '')
  } finally {
    clearRouteCache()
    rmSync(dir, { recursive: true, force: true })
  }
})
