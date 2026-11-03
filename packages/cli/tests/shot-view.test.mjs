// `pcbjs shot --view`: the schematic is a view like 2D and 3D, each a render spec with the run's look.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shotJobs, shotViews } from '../dist/shot.js'

test('--view repeats: none is the two board views, each given once in 2D, 3D, schematic order', () => {
  assert.deepEqual(shotViews(undefined), ['2d', '3d'])
  assert.deepEqual(shotViews([]), ['2d', '3d'])
  assert.deepEqual(shotViews(['sch', '2d', '3d', 'sch']), ['2d', '3d', 'sch'])
  assert.deepEqual(shotViews(['sch']), ['sch'])
})

test('each view is a spec of its own; the board side, mirror, layers and explode stay out of the schematic file name', () => {
  const look = { layers: ['F.Cu'], theme: 'light', side: 'B', mirror: true, explode: 0.5 }
  const jobs = shotJobs([{ entry: '/p/blinky.pcb.tsx', name: 'Blinky', targets: [null] }], shotViews(['2d', '3d', 'sch']), '/o', look, ['Q1'])
  assert.deepEqual(
    jobs.map(j => [j.spec.view, j.file]),
    [
      ['2d', '/o/Blinky-2d-select-Q1-F.Cu-back-mirror-light.png'],
      ['3d', '/o/Blinky-3d-explode50-select-Q1-F.Cu-back-mirror-light.png'],
      ['sch', '/o/Blinky-sch-select-Q1-light.png'],
    ],
  )
  assert.deepEqual(jobs[2].spec, { ...look, view: 'sch', entry: '/p/blinky.pcb.tsx', frame: 'Q1', highlight: ['Q1'] })
})

test('a target is part of the file name and the spec', () => {
  const [j] = shotJobs([{ entry: '/p/m.tsx', name: 'Multi', targets: ['Rev B'] }], ['2d'], '/o')
  assert.equal(j.file, '/o/Multi-rev-b-2d.png')
  assert.equal(j.spec.target, 'Rev B')
})
