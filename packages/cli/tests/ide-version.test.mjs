// compareVersions orders versions by semver precedence, pre-release tags included, so `pcbjs ide` sees a newer beta;
// compareExtensions also reads the Marketplace scheme scripts/package.mjs of @pcbjs/vscode packs the VSIX with.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareExtensions, compareVersions, marketVersion } from '../dist/ide.js'

test('compareVersions: semver order, pre-releases before their release, numeric identifiers by number', () => {
  const order = [
    '0.0.1',
    '0.1.0-alpha',
    '0.1.0-alpha.1',
    '0.1.0-alpha.beta',
    '0.1.0-beta',
    '0.1.0-beta.1',
    '0.1.0-beta.2',
    '0.1.0-beta.11',
    '0.1.0-rc.1',
    '0.1.0',
    '0.1.1',
    '0.2.0',
    '1.0.0',
  ]
  for (let i = 0; i < order.length; i++)
    for (let j = 0; j < order.length; j++) {
      assert.equal(compareVersions(order[i], order[j]), Math.sign(i - j), `${order[i]} vs ${order[j]}`)
    }
  assert.equal(compareVersions('0.1.0+build.5', '0.1.0'), 0)
})

test('marketVersion: a train pre-release maps to x.y.(1000z + n), a plain version stays', () => {
  assert.equal(marketVersion('0.0.1-beta.0'), '0.0.1000')
  assert.equal(marketVersion('0.0.1-beta.12'), '0.0.1012')
  assert.equal(marketVersion('0.1.0-beta.3'), '0.1.3')
  assert.equal(marketVersion('0.0.1-next.1a2b3c4'), '0.0.1000')
  assert.equal(marketVersion('0.0.1999'), '0.0.1999')
})

test('compareExtensions: either scheme on either side', () => {
  assert.equal(compareExtensions('0.0.0', '0.0.1000'), -1)
  assert.equal(compareExtensions('0.0.1-beta.1', '0.0.1000'), 1)
  assert.equal(compareExtensions('0.0.1001', '0.0.1-beta.1'), 0)
  assert.equal(compareExtensions('0.0.1999', '0.0.2-beta.0'), -1)
})
