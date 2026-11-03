// A finding's mark, computed once by the export, puts every finding on the same line the viewer's own matching used to: a finding whose
// evidence lies on a ratsnest line of its net takes that line, a failed leg on none its own; checked on a failed route inside a ring and
// over the review boards, then drawn by the renderer as the line it is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { h } from '@pcbjs/core/jsx-runtime'
import PCB, { route } from '@pcbjs/core'
import { refNet } from '@pcbjs/core/ref'
import { compileBoard } from '@pcbjs/compile'
import { boardFindings, siteFindings } from '@pcbjs/export/internal/findings'
import { findingMarks } from '../../cli/dist/render/marks.js'
import { fp, handle, netOf } from './parts.mjs'

const EXAMPLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples')
const EPS = 1e-6
const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS
const sameSeg = (a, b) => (same(a[0], b[0]) && same(a[1], b[1])) || (same(a[0], b[1]) && same(a[1], b[0]))

/** The viewer's matching before marks, over a finding's own fields: the ratsnest line of its net its segments match, a failed leg's own line, else none. */
function oldLine(d, ratsnest) {
  const net = d.refs.map(refNet).find(n => n !== null) ?? undefined
  const segs = d.witness?.segments ?? []
  const i = ratsnest.findIndex(r => (!net || r.net === net) && segs.some(s => sameSeg(s, [r.from, r.to])))
  if (i >= 0) return i
  return d.rule === 'route-failed' && segs.length ? null : undefined
}

/** Each DRC finding of a board as [rule, the old line, the mark's line]; a line index, null for a failed leg's own line, undefined for no line. */
const compare = (drc, ratsnest) => drc.map(d => [d.rule, oldLine(d, ratsnest), d.mark && 'line' in d.mark ? d.mark.rats : undefined])

const smd = (ref, x, y, net) => fp({ ref, at: `${x} ${y}`, nets: { 1: net } }, h('pad', { num: 1, size: 1, type: 'smd' }))

test('a route that cannot leave a ring: its route-failed and its unconnected net lie on the ratsnest line, as before', () => {
  const ring = route('3 3').net(netOf('B')).width(0.5).L(7, 3).L(7, 7).L(3, 7).L(3, 3)
  const b = compileBoard(
    h(
      PCB,
      { name: 'Marks' },
      h('rect', { layer: 'Edge.Cuts', x: 0, y: 0, w: 20, h: 10 }),
      smd('J1', 5, 5, 'SIG'),
      smd('J2', 15, 5, 'SIG'),
      ring,
      route(handle('J1.1'), handle('J2.1')).layers(['F.Cu']),
    ),
    { cache: false },
  )
  const { drc } = siteFindings(b, '')
  const rows = compare(drc, b.ratsnest)
  const lines = rows.filter(([, was]) => was !== undefined)
  assert.ok(
    lines.some(([rule]) => rule === 'route-failed'),
    JSON.stringify(rows),
  )
  for (const [rule, was, now] of rows) assert.equal(now, was, rule)
  // the renderer draws the same line, no ring at its middle
  const f = boardFindings(b).find(x => x.rule === 'route-failed')
  const marks = findingMarks([f], 'light')
  assert.deepEqual(
    marks.map(m => m.type),
    ['line', 'label'],
  )
  assert.ok(sameSeg([marks[0].at, marks[0].to], f.mark.line))
})

async function sites(example, entries = []) {
  const { resolveConfig } = await import('@pcbjs/cli/internal/config')
  const { pluginState } = await import('@pcbjs/cli/internal/site')
  const { compileServer, compileSlots } = await import('@pcbjs/cli/internal/compile')
  const { viteLoader } = await import('@pcbjs/cli/internal/loader')
  const { DATA_FORMATS } = await import('@pcbjs/cli/internal/project')
  const cfg = await resolveConfig(entries, 'build', undefined, join(EXAMPLES, example))
  const state = pluginState(cfg)
  const server = await compileServer(cfg)
  try {
    await compileSlots(viteLoader(server), cfg, state.slots, new Map(), { formats: DATA_FORMATS })
  } finally {
    await server.close()
  }
  return state.slots.flatMap(s => s.compiled ?? []).map(c => c.site)
}

const REVIEW = ['highspeed', 'usb-hub', 'eth-phy', 'lvds-camera', 'sdram', 'qfn-breakout', 'badge', 'esp32-sensor', 'led-matrix', 'stm32-dev', 'usbc-led']

test('the review boards: every DRC finding the viewer put on a line keeps that line in its mark, and no other takes one', { timeout: 900000 }, async () => {
  let checked = 0
  for (const example of REVIEW)
    for (const site of await sites(example)) {
      for (const [rule, was, now] of compare(site.drc, site.ratsnest)) assert.equal(now, was, `${example} ${site.name}: ${rule}`)
      checked += site.drc.length
    }
  assert.ok(checked > 0)
})
