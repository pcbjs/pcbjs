// Models fetched on first use: where each source is cached, its download URL and licence, and the resolver's offline path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { remoteSource } from '@pcbjs/compile/models'
import { KICAD_3D_TAG, fetchedPath, fetchNotice, licenceOf, remoteResolver, retryFetches, sourceUrl } from '../dist/fetch-model.js'

const KICAD = 'kicad:Crystal.3dshapes/Crystal_SMD_3225-4Pin_3.2x2.5mm.step'

test('a source is cached by its kind under .pcbjs/models/fetched', () => {
  assert.equal(fetchedPath('/p', KICAD), `/p/.pcbjs/models/fetched/kicad-${KICAD_3D_TAG}/Crystal.3dshapes/Crystal_SMD_3225-4Pin_3.2x2.5mm.step`)
  assert.equal(fetchedPath('/p', 'lcsc:c165948'), '/p/.pcbjs/models/fetched/lcsc/C165948.step')
  assert.equal(fetchedPath('/p', 'https://example.com/a/b%20c.step'), '/p/.pcbjs/models/fetched/example.com/a/b c.step')
  assert.equal(sourceUrl('kicad:Battery.3dshapes/X.wrl'), `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/${KICAD_3D_TAG}/Battery.3dshapes/X.step`)
  assert.match(licenceOf(KICAD), /CC-BY-SA 4\.0 with the KiCad library exception/)
  assert.match(licenceOf('lcsc:C1'), /no licence stated/)
})

test('the compile takes kicad:, lcsc:, https and KiCad variable paths as fetched sources', () => {
  assert.equal(remoteSource('${KICAD9_3DMODEL_DIR}/Crystal.3dshapes/X.step'), 'kicad:Crystal.3dshapes/X.step')
  assert.equal(remoteSource('lcsc:C123'), 'lcsc:C123')
  assert.equal(remoteSource('https://x.org/a.step'), 'https://x.org/a.step')
  assert.equal(remoteSource('./models/a.step'), null)
})

test('the resolver finds a cached file, and offline gives null and one notice naming the parts', () => {
  const root = mkdtempSync(join(tmpdir(), 'pcbjs-fetch-'))
  const had = process.env.PCBJS_OFFLINE
  try {
    const file = fetchedPath(root, 'lcsc:C1')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'ISO-10303-21;')
    process.env.PCBJS_OFFLINE = '1'
    retryFetches()
    const resolve = remoteResolver(root)
    assert.equal(resolve('lcsc:C1'), file)
    assert.equal(resolve('lcsc:C2'), null)
    const line = fetchNotice('B', [{ ref: 'J2', source: 'lcsc:C2' }])
    assert.match(line, /^pcbjs: B: J2 shows a dashed outline, the model did not download \(PCBJS_OFFLINE is set\); run pcbjs model fetch$/)
    assert.equal(fetchNotice('B', [{ ref: 'J2', source: 'lcsc:C2' }]), null)
  } finally {
    if (had === undefined) delete process.env.PCBJS_OFFLINE
    else process.env.PCBJS_OFFLINE = had
    retryFetches()
    rmSync(root, { recursive: true, force: true })
  }
})
