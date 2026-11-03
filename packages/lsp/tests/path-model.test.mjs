// The path editor's model: parse SVG path data to rows, edit rows, serialise, validate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from '../dist/path-model.js'

/** The rows without their text spans. */
const bare = rows => rows.map(({ cmd, args }) => ({ cmd, args }))

const D = 'M 3 10 H 9 V 15 L 12 16 Z'

test('parse path data into one row per command, each with its text in the string', () => {
  const { rows, errors } = P.parsePath(D)
  assert.deepEqual(errors, [])
  assert.deepEqual(
    rows.map(r => D.slice(r.start, r.end)),
    ['M 3 10', 'H 9', 'V 15', 'L 12 16', 'Z'],
  )
  assert.deepEqual(bare(rows), [
    { cmd: 'M', args: ['3', '10'] },
    { cmd: 'H', args: ['9'] },
    { cmd: 'V', args: ['15'] },
    { cmd: 'L', args: ['12', '16'] },
    { cmd: 'Z', args: [] },
  ])
  assert.equal(P.serialise(rows), D)
  assert.deepEqual(P.validate(rows), [])
})

test('parse the other spellings: relative forms, implicit repeats, commas, curves', () => {
  const { rows, errors } = P.parsePath('M 0 0 10 0 l 1,2 3 4 h -1 v.5 A 1 1 0 0 1 2 2 Z')
  assert.deepEqual(errors, [])
  assert.deepEqual(
    rows.map(r => [r.cmd, ...r.args].join(' ')),
    ['M 0 0', 'L 10 0', 'l 1 2', 'l 3 4', 'h -1', 'v .5', 'A 1 1 0 0 1 2 2', 'Z'],
  )
  assert.equal(P.serialise(rows), 'M 0 0 L 10 0 l 1 2 l 3 4 h -1 v .5 A 1 1 0 0 1 2 2 Z')
  assert.deepEqual(P.validate(rows), [])
  assert.deepEqual(P.parsePath('').rows, [])
})

test('edit rows: set an argument, change a command, insert at the cursor, delete', () => {
  let rows = P.parsePath(D).rows
  rows = P.setArg(rows, 3, 0, '13')
  assert.equal(P.serialise(rows), 'M 3 10 H 9 V 15 L 13 16 Z')
  // an absolute command starts at the cursor the rows before it make
  rows = P.insertRow(rows, 1, 'V')
  assert.equal(P.serialise(rows), 'M 3 10 H 9 V 10 V 15 L 13 16 Z')
  assert.equal(P.serialise(P.insertRow(rows, -1, 'L')), 'L 0 0 M 3 10 H 9 V 10 V 15 L 13 16 Z')
  rows = P.deleteRow(rows, 2)
  assert.equal(P.serialise(rows), 'M 3 10 H 9 V 15 L 13 16 Z')
  // H to L keeps x and fills y from the cursor; L to V keeps y
  assert.equal(P.serialise(P.setCommand(rows, 1, 'L')), 'M 3 10 L 9 10 V 15 L 13 16 Z')
  assert.equal(P.serialise(P.setCommand(rows, 3, 'V')), 'M 3 10 H 9 V 15 V 16 Z')
  assert.deepEqual(P.cursorAfter(rows, 2), { x: 9, y: 15 })
  assert.deepEqual(P.cursorAfter(rows, 4), { x: 3, y: 10 }, 'Z returns to the start')
})

test('validation: M first, bad numbers, unknown commands; the reader reports what it could not read', () => {
  const v = s => P.validate(P.parsePath(s).rows)
  assert.match(v('H 3').join(), /SVG path data starts with M/)
  assert.match(
    P.validate([
      { cmd: 'M', args: ['0', '0'] },
      { cmd: 'L', args: ['1', 'x'] },
    ]).join(),
    /argument 2 of L is not a number/,
  )
  assert.match(P.validate([{ cmd: 'X', args: [] }]).join(), /unknown command X/)
  assert.match(P.parsePath('M 0 0 L 1').errors.join(), /L expects 2 numbers, found 1/)
  assert.match(P.parsePath('M 0 0 X 1 2').errors.join(), /unknown command X/)
  assert.match(P.parsePath('M 0 0 ; Z').errors.join(), /unexpected ";"/)
  assert.ok(P.commands().includes('C') && !P.commands().includes('X'))
})
