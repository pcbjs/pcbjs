// The viewer's sourcing helpers, imported straight from the client TypeScript: the resolved part number, the unsourced count and the TSV copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bomRowOf, bomTsv, matchedKey, rowMpn, sourceLabel, sourcingEntries, sourcingLine, sourcingTitle, unsourcedCount, unsourcedText } from '../src/sourcing.ts'

const lcsc = { mpn: 'C25804', tag: 'LCSC', all: { MPN: 'RC0603FR-0710KL', 'MPN:LCSC': 'C25804' }, manufacturer: 'Yageo' }
const catchAll = { mpn: 'LTST-C191KRKT', tag: '', all: { MPN: 'LTST-C191KRKT' } }
const none = { mpn: null, tag: null, all: {} }
const bom = [
  { refs: ['R1', 'R2'], value: '10k', footprint: 'R:R_0603', qty: 2, fields: {}, sourcing: lcsc },
  { refs: ['D1'], value: 'red', footprint: 'LED:LED_0603', qty: 1, fields: {}, sourcing: catchAll },
  { refs: ['J1'], value: 'USB\tC', footprint: 'Conn:USB_C', qty: 1, fields: {}, sourcing: none },
  { refs: ['TP1'], value: 'TP', footprint: 'TP:Pad', qty: 1, fields: {}, sourcing: none },
]

test('sourcing: the resolved part number and the label of the tag that matched', () => {
  assert.equal(rowMpn(bom[0]), 'C25804')
  assert.equal(rowMpn(bom[2]), null)
  assert.equal(sourceLabel(lcsc), 'LCSC')
  assert.equal(sourceLabel(catchAll), 'MPN')
  assert.equal(sourceLabel(none), null)
  assert.equal(sourceLabel(undefined), null)
  assert.equal(matchedKey(lcsc), 'MPN:LCSC')
  assert.equal(matchedKey(catchAll), 'MPN')
  assert.equal(matchedKey(none), null)
})

test('sourcing: unsourced rows are counted and named', () => {
  assert.equal(unsourcedCount(bom), 2)
  assert.equal(unsourcedText(2), '2 rows without a part number')
  assert.equal(unsourcedText(1), '1 row without a part number')
  assert.equal(unsourcedText(0), null)
  assert.equal(unsourcedCount(undefined), 0)
  assert.equal(unsourcedCount([]), 0)
})

test('sourcing: old data without sourcing falls back to the MPN field', () => {
  const old = [
    { refs: ['R1'], value: '10k', footprint: 'R:R_0603', qty: 1, fields: { MPN: 'X1' } },
    { refs: ['C1'], value: '1u', footprint: 'C:C_0603', qty: 1, fields: {} },
    { refs: ['C2'], value: '1u', footprint: 'C:C_0603', qty: 1 },
  ]
  assert.equal(rowMpn(old[0]), 'X1')
  assert.equal(unsourcedCount(old), 2)
  assert.equal(sourcingTitle(undefined), '')
  assert.deepEqual(sourcingEntries(undefined), [])
})

test('sourcing: the header line from the target tags', () => {
  assert.equal(sourcingLine(['LCSC', 'CN']), 'Sourcing: LCSC, CN')
  assert.equal(sourcingLine([]), 'Sourcing: MPN only')
  assert.equal(sourcingLine(undefined), null)
})

test('sourcing: every key in the tooltip and the part table, in the order given', () => {
  assert.equal(sourcingTitle(lcsc), 'MPN: RC0603FR-0710KL\nMPN:LCSC: C25804')
  assert.deepEqual(sourcingEntries(lcsc), [['MPN', 'RC0603FR-0710KL'], ['MPN:LCSC', 'C25804']])
  assert.equal(bomRowOf(bom, 'R2'), bom[0])
  assert.equal(bomRowOf(bom, 'Q9'), null)
  assert.equal(bomRowOf(undefined, 'R1'), null)
})

test('sourcing: the BOM as TSV with a header, refs joined, tabs and newlines flattened, empty mpn when unsourced', () => {
  assert.equal(bomTsv(bom), [
    'refs\tvalue\tfootprint\tqty\tmpn',
    'R1,R2\t10k\tR:R_0603\t2\tC25804',
    'D1\tred\tLED:LED_0603\t1\tLTST-C191KRKT',
    'J1\tUSB C\tConn:USB_C\t1\t',
    'TP1\tTP\tTP:Pad\t1\t',
  ].join('\n') + '\n')
  assert.equal(bomTsv(undefined), 'refs\tvalue\tfootprint\tqty\tmpn\n')
})
