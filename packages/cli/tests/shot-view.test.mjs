// `pcbjs shot --view`: the schematic is a view of the viewer, shot with its query like 2D and 3D.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shotJobs, shotQuery, shotViews } from '../dist/shot.js'

test('--view: both is the two board views, all adds the schematic', () => {
  assert.deepEqual(shotViews(undefined), ['2d', '3d'])
  assert.deepEqual(shotViews('both'), ['2d', '3d'])
  assert.deepEqual(shotViews('all'), ['2d', '3d', 'sch'])
  assert.deepEqual(shotViews('sch'), ['sch'])
})

test('the schematic loads the viewer with view=sch, keeping --select and --theme', () => {
  assert.equal(shotQuery('sch', { select: 'Q1', theme: 'dark' }), '?view=sch&select=Q1&theme=dark')
  assert.equal(shotQuery('sch', { side: 'bottom', explode: 0.5 }), '?view=sch', 'the board side and explode do not apply')
  const jobs = shotJobs([{ name: 'Blinky', targets: [null] }], shotViews('all'), '/o', { select: 'Q1', layer: 'F.Cu', theme: 'light' })
  assert.deepEqual(jobs.map(j => [j.view, j.path, j.layer ?? null, j.file]), [
    ['2d', '/board/Blinky', 'F.Cu', '/o/Blinky-2d-select-Q1-F.Cu-light.png'],
    ['3d', '/board/Blinky', 'F.Cu', '/o/Blinky-3d-select-Q1-F.Cu-light.png'],
    ['sch', '/board/Blinky', null, '/o/Blinky-sch-select-Q1-light.png'],
  ])
})
