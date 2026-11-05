import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareReports } from '../pcbjs-best-practices/scripts/compare-reports.mjs'

const reviewed = [
  { pad: '1', signal: 'D_P', disposition: 'connected' },
  { pad: '2', signal: 'D_N', disposition: 'connected' },
  { pad: '3', signal: 'GND', disposition: 'connected' },
  { pad: '4', signal: 'GND', disposition: 'connected' },
  { pad: '5', signal: 'NC', disposition: 'datasheet-NC' },
  { pad: '6', signal: 'NC', disposition: 'datasheet-NC' },
  { pad: '7', signal: 'RESET', disposition: 'unresolved' },
]
const physicalPads = ['1', '2', '3', '4', '5', '6', '7']
function audit(rows) {
  assert.deepEqual(rows.map(r => r.pad).sort(), physicalPads)
  for (const signal of ['D_P', 'D_N', 'RESET']) assert.equal(rows.filter(r => r.signal === signal).length, 1)
  assert.equal(rows.find(r => r.pad === '7').disposition, 'unresolved')
}
function endpoints(actual) {
  for (const [pad, net] of [
    ['1', 'USB_P'],
    ['2', 'USB_N'],
  ])
    assert.equal(actual[pad], net)
}
const guard = actual => assert.deepEqual(actual, { x: 52, y: 25, rotate: 0, side: 'F' })

test('reviewed pin coverage preserves repeated ground/NC and unresolved required pins', () => {
  audit(reviewed)
  assert.throws(() => audit(reviewed.slice(0, -1)))
  assert.throws(() => audit(reviewed.map(r => (r.pad === '7' ? { ...r, pad: '8' } : r))))
  assert.throws(() => audit(reviewed.map(r => (r.pad === '2' ? { ...r, signal: 'D_P' } : r))))
  assert.throws(() => audit(reviewed.map(r => (r.pad === '7' ? { ...r, disposition: 'datasheet-NC' } : r))))
  endpoints({ 1: 'USB_P', 2: 'USB_N' })
  assert.throws(() => endpoints({ 1: 'USB_N', 2: 'USB_P' }))
  guard({ x: 52, y: 25, rotate: 0, side: 'F' })
  assert.throws(() => guard({ x: 53, y: 25, rotate: 0, side: 'F' }))
  assert.throws(() => guard({ x: 52, y: 25, rotate: 90, side: 'F' }))
})

const finding = (fingerprint, x, value = 0.1) => ({
  fingerprint,
  at: { x, y: 0 },
  severity: 'error',
  measured: { value, unit: 'mm' },
  required: { value: 0.2, unit: 'mm' },
  message: 'clearance',
  src: [{ line: 1 }],
})
const report = findings => ({
  schema: 'pcbjs.check/1',
  result: 'fail',
  exit: 1,
  diagnostics: [],
  typecheck: { status: 'ok' },
  tests: { status: 'fail' },
  boards: [{ entry: 'pcb.tsx', name: 'Draft', target: null, findings, status: 'fail', snapshot: 'fixture' }],
})
test('report review consumes duplicate identities once and retains failures and semantic changes', () => {
  const before = report([finding('same', 1), finding('same', 9), finding('fixed', 3), finding('rule', 4)])
  const after = report([
    finding('same', 9),
    { ...finding('same', 1, 0.05), src: [{ line: 50 }] },
    finding('added', 6),
    { ...finding('rule', 4), required: { value: 0.1, unit: 'mm' } },
  ])
  const result = compareReports(before, after)
  assert.equal(result.after.exit, 1)
  assert.equal(result.after.tests.status, 'fail')
  assert.equal(result.boards[0].retained, 3)
  assert.equal(result.boards[0].changed.length, 2)
  assert.deepEqual(
    result.boards[0].added.map(f => f.fingerprint),
    ['added'],
  )
  assert.deepEqual(
    result.boards[0].resolved.map(f => f.fingerprint),
    ['fixed'],
  )
  assert.equal(compareReports(before, report(before.boards[0].findings.map(f => ({ ...f, src: [{ line: 99 }] })))).boards[0].changed.length, 0)
  assert.equal(compareReports(before, { ...after, boards: [] }).removedBoards.length, 1)
})
