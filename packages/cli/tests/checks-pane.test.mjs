import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paneUrl } from '../dist/session/plugin.js'
import { isView } from '../dist/session/selection.js'

test('checks uses the existing IDE pane route, preserving scope and query identity', () => {
  assert.equal(paneUrl('/board/Board?ide=1&view=checks&panel=0'), '/pane.html?ide=1&view=checks&panel=0')
  assert.equal(paneUrl('/project/board/Board/target?ide=1&view=checks&focus=drc%3Atest'), '/pane.html?ide=1&view=checks&focus=drc%3Atest')
  assert.equal(paneUrl('/board/Board?view=checks'), null, 'ordinary browser routing stays with the viewer app')
  assert.equal(paneUrl('/asset.js?ide=1&view=checks'), null)
  assert.equal(isView('checks'), true, 'selection provenance accepts the fourth viewer')
  assert.equal(isView('render'), false)
})
