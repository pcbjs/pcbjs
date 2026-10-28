// The Gerber self check on every demo and review board: each fab set reads back as its board, with no fab-mismatch.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../dist/config.js'
import { pluginState } from '../dist/plugin.js'
import { compileServer, compileSlots } from '../dist/check.js'

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url))
// usb3-hub and motor-stack are boards under review that are still being built
const BOARDS = [
  'demo',
  'badge',
  'esp32-sensor',
  'eth-phy',
  'highspeed',
  'led-matrix',
  'lvds-camera',
  'psu',
  'qfn-breakout',
  'sdram',
  'sensor-hat',
  'stm32-dev',
  'usb-hub',
  'usbc-led',
]

for (const ex of BOARDS) {
  const root = join(EXAMPLES, ex)
  test(`fab check: ${ex} reads back as its board`, { skip: !existsSync(join(root, 'pcb.config.ts')) }, async () => {
    const cfg = await resolveConfig([], 'build', undefined, root, () => {})
    cfg.fabCheck = true
    const state = pluginState(cfg)
    const server = await compileServer(cfg, state)
    const errors = new Map()
    try {
      await compileSlots(server, cfg, state.slots, errors)
    } finally {
      await server.close()
    }
    assert.equal(errors.size, 0, [...errors.values()].map(e => e?.message).join('\n'))
    for (const s of state.slots)
      for (const c of s.compiled) {
        const bad = c.board.drc.filter(d => d.rule === 'fab-mismatch')
        assert.deepEqual(
          bad.map(d => `${c.board.name} ${d.layer}: ${d.message}`),
          [],
        )
        assert.match(c.fab.readme, /Gerber self check: passed/)
      }
  })
}
