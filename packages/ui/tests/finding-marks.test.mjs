// Findings as the views annotate them, by the mark the compiler gave each: a ratsnest line carries the findings marked on it, a failed
// leg marked on no ratsnest line is a line of its own, every other finding a marker where its mark says, and labels moved apart on screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !spec.endsWith('.ts')) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
const { DOT, RATS, ratsZoom, dotLook, dotShape, dotTitle, dotUnder, findingDots, findingLines, findingNotes, labelOf, noteShown, ratsWidth, shownLines, spread, worst } =
  await import('../src/finding-marks.ts')

const onRats = {
  line: [
    [5, 10],
    [15, 10],
  ],
  rats: 0,
  layer: 'F.Cu',
}
// as the scratch boards compile: the route blocked by a keepout, and the same net with no route at all
const unconnected = {
  id: 'drc:unconnected:c5462aeac7b3',
  severity: 'error',
  rule: 'unconnected',
  message: 'net VBAT is not fully connected',
  at: [10, 10],
  refs: ['net:VBAT', 'TP1/1', 'TP2/1'],
  mark: onRats,
  witness: {
    segments: [
      [
        [5, 10],
        [15, 10],
      ],
    ],
  },
}
const failed = {
  id: 'drc:route-failed:b5999de1d865',
  severity: 'error',
  rule: 'route-failed',
  message: 'cannot route net VBAT',
  at: [10, 10],
  layer: 'F.Cu',
  refs: ['net:VBAT'],
  mark: onRats,
  witness: {
    layer: 'F.Cu',
    segments: [
      [
        [5, 10],
        [15, 10],
      ],
    ],
  },
}
const clearance = {
  id: 'drc:clearance:0123456789ab',
  severity: 'warning',
  rule: 'clearance',
  message: 'too close',
  at: [3, 4],
  layer: 'B.Cu',
  refs: [],
  mark: { at: [3, 4], layer: 'B.Cu', side: 'B' },
}
const site = drc => ({ drc, erc: [], ratsnest: [{ net: 'VBAT', from: [5, 10], to: [15, 10] }] })

test('an unconnected net: its ratsnest line carries the finding, and no marker is left', () => {
  const s = site([unconnected, clearance])
  const lines = findingLines(s)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].rats, 0)
  assert.deepEqual(
    lines[0].findings.map(d => d.rule),
    ['unconnected'],
  )
  const notes = findingNotes(s, lines)
  assert.deepEqual(
    notes.map(n => [n.rule, n.line]),
    [
      ['clearance', null],
      ['unconnected', 0],
    ],
  )
  assert.deepEqual(notes[1].at, [10, 10], 'the label at the middle of the line')
  assert.equal(notes[0].layer, 'B.Cu')
  assert.equal(notes[0].side, 'B')
})

test('a route-failed finding joins the ratsnest line of its leg, reversed or not, the worst first', () => {
  const lines = findingLines(site([{ ...unconnected, severity: 'warning' }, failed]))
  assert.equal(lines.length, 1)
  assert.deepEqual(
    lines[0].findings.map(d => d.rule),
    ['route-failed', 'unconnected'],
  )
  assert.equal(lines[0].severity, 'error')
})

test('a failed leg no ratsnest line coincides with is a line of its own; a finding on another net never takes the line', () => {
  const leg = {
    ...failed,
    mark: {
      line: [
        [5, 10],
        [9, 12],
      ],
      rats: null,
      layer: 'F.Cu',
    },
  }
  const other = { ...unconnected, refs: ['net:GND'], mark: { at: [10, 10], layer: 'F.Cu', side: 'F' } }
  const s = site([leg, other])
  const lines = findingLines(s)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].rats, null)
  assert.deepEqual(
    [lines[0].from, lines[0].to],
    [
      [5, 10],
      [9, 12],
    ],
  )
  assert.deepEqual(
    findingNotes(s, lines).map(n => [n.rule, n.line]),
    [
      ['unconnected', null],
      ['route-failed', 0],
    ],
  )
})

test('an ERC finding is a dot where its mark puts it, a finding marked nowhere no dot at all', () => {
  const pin = {
    id: 'erc:single-pin-net:0123456789ab',
    severity: 'warning',
    rule: 'single-pin-net',
    message: 'm',
    at: null,
    refs: ['J1/2'],
    mark: { at: [11, 2], layer: 'B.Cu', side: 'B' },
  }
  const sheet = { ...pin, id: 'erc:sch-dangling:0123456789ab', layer: 'sch', at: [40, 40], mark: null }
  const notes = findingNotes({ ...site([]), erc: [pin, sheet] })
  assert.deepEqual(
    notes.map(n => [n.check, n.layer, n.side, n.at]),
    [['erc', 'B.Cu', 'B', [11, 2]]],
  )
})

test('worst severity of a list', () => {
  assert.equal(worst([{ severity: 'info' }, { severity: 'warning' }]), 'warning')
  assert.equal(worst([{ severity: 'warning' }, { severity: 'error' }]), 'error')
})

test('labels sit up and right of their markers, a line label centred on its middle, and move up past the ones before them', () => {
  const tl = spread(
    [
      { at: [100, 100], w: 40, h: 15, centre: false },
      { at: [102, 101], w: 40, h: 15, centre: false },
      { at: [300, 100], w: 40, h: 15, centre: true },
    ],
    [10, 8],
    2,
  )
  assert.deepEqual(tl[0], [110, 77])
  assert.deepEqual(tl[1], [112, 77 - 15 - 2])
  assert.deepEqual(tl[2], [280, 92.5])
})

test('an unconnected finding is labelled by its net behind the broken-connection icon, never by its rule; any other by its rule', () => {
  assert.deepEqual(labelOf(unconnected), { text: 'VBAT', broken: true })
  assert.deepEqual(labelOf({ rule: 'unconnected', refs: ['net:GND', 'TP1/1'] }), { text: 'GND', broken: true })
  assert.deepEqual(labelOf(failed), { text: 'route-failed', broken: false })
  const notes = findingNotes(site([unconnected, failed, clearance]))
  assert.deepEqual(
    notes.map(n => [n.rule, n.text, n.broken]),
    [
      ['clearance', 'clearance', false],
      ['unconnected', 'VBAT', true],
      ['route-failed', 'route-failed', false],
    ],
  )
})

test('ratsnest labels show in the DRC tab, else only on the line hovered, else on the lines holding a focused or selected finding; markers always', () => {
  const s = site([unconnected, clearance])
  const other = {
    ...unconnected,
    id: 'drc:unconnected:000000000002',
    refs: ['net:GND'],
    mark: {
      line: [
        [1, 1],
        [2, 2],
      ],
      rats: 1,
      layer: 'F.Cu',
    },
    witness: {
      segments: [
        [
          [1, 1],
          [2, 2],
        ],
      ],
    },
  }
  const lines = findingLines({ ...s, drc: [unconnected, other], ratsnest: [...s.ratsnest, { net: 'GND', from: [1, 1], to: [2, 2] }] })
  const none = new Set()
  assert.deepEqual([...shownLines(lines, { review: true, hover: null, ids: none })], [0, 1])
  assert.deepEqual([...shownLines(lines, { review: false, hover: null, ids: none })], [])
  assert.deepEqual([...shownLines(lines, { review: false, hover: 1, ids: new Set([unconnected.id]) })], [1], 'the hover alone')
  assert.deepEqual([...shownLines(lines, { review: false, hover: null, ids: new Set([unconnected.id]) })], [0])
  assert.equal(noteShown({ line: null }, new Set()), true)
  assert.equal(noteShown({ line: 1 }, new Set([0])), false)
})

test('the ratsnest width follows the zoom between a floor and a ceiling, a finding and the focused line wider by their ratios', () => {
  assert.equal(ratsWidth('plain', 1), RATS.fit, 'the plain width at the default fit')
  assert.ok(ratsWidth('plain', 2) > RATS.fit && ratsWidth('plain', 2) < RATS.fit * 2, 'zooming in thickens it a little')
  assert.equal(ratsWidth('plain', 100), RATS.ceiling)
  assert.equal(ratsWidth('plain', 0.01), RATS.floor, 'zooming out never lets it vanish')
  assert.equal(ratsWidth('finding', 1), RATS.fit * RATS.ratio.finding)
  assert.equal(ratsWidth('focus', 100), RATS.ceiling * RATS.ratio.focus)
  assert.deepEqual([RATS.dash, RATS.gap], [3, 2], 'dashes three widths long, two apart')
  assert.ok(RATS.hit === 6 && RATS.hit > ratsWidth('focus', 1), 'the pointer target is at least 6 px, wider than the drawn line at fit')
  assert.ok(RATS.opacity.plain < RATS.opacity.finding && RATS.opacity.finding <= RATS.opacity.focus)
  assert.equal(ratsZoom(30, 20, 600), 1, 'a 20 mm board at 30 px per mm fills a 600 px pane')
})

test('the dots: every finding not carried by a line, the worst drawn last; a line keeps its own', () => {
  const info = {
    id: 'drc:silk:1',
    severity: 'info',
    rule: 'silk-over-pad',
    message: 'silk on a pad',
    at: [1, 1],
    layer: 'F.SilkS',
    refs: [],
    mark: { at: [1, 1], layer: 'F.SilkS', side: 'F' },
  }
  const s = site([unconnected, clearance, info])
  s.erc = [{ id: 'erc:pin:1', severity: 'error', rule: 'pin-type', message: 'two outputs', at: null, refs: ['TP1/1'], mark: { at: [5, 10], layer: 'F.Cu', side: 'F' } }]
  const dots = findingDots(findingNotes(s))
  assert.deepEqual(
    dots.map(n => n.rule),
    ['silk-over-pad', 'clearance', 'pin-type'],
  )
  assert.ok(!dots.some(n => n.rule === 'unconnected'), 'the unconnected net stays on its ratsnest line')
  assert.deepEqual(dots.map(dotShape), ['ring', 'disc', 'diamond'])
  assert.deepEqual(dots[2].at, [5, 10], 'an ERC dot sits on the pad it names')
  assert.equal(dotTitle(dots[1]), 'clearance')
})

test("a dot's look: larger under the pointer and larger again in focus, faint when stale, gone outside an isolation", () => {
  const at = o => dotLook({ stale: false, focus: false, hover: false, out: false, ...o })
  assert.deepEqual(at({}), { size: DOT.size, alpha: 1 })
  assert.deepEqual(at({ hover: true }), { size: DOT.hover, alpha: 1 })
  assert.deepEqual(at({ hover: true, focus: true }), { size: DOT.focus, alpha: 1 })
  assert.deepEqual(at({ stale: true }), { size: DOT.size, alpha: DOT.stale })
  assert.deepEqual(at({ out: true, focus: true }), { size: 0, alpha: 0 })
})

test('the pointer test: the nearest dot within the radius, the one drawn later on a tie, none off screen or too far', () => {
  const xy = new Float32Array([10, 10, 14, 10, NaN, NaN, 12, 10])
  assert.equal(dotUnder(xy, [10.5, 10], 8), 0)
  assert.equal(dotUnder(xy, [13.6, 10], 8), 1)
  assert.equal(dotUnder(xy, [12, 10], 8), 3, 'a tie goes to the dot on top')
  assert.equal(dotUnder(xy, [40, 40], 8), null)
  assert.equal(dotUnder([], [0, 0], 8), null)
})
