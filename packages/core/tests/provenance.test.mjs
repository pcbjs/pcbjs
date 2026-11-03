// One stack frame parser and one test for pcbjs's own frames; the chain table and its inverse.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { framesOf, isOwnFile, isUserFile, localFrames, parseFrame, userFrames } from '../dist/provenance.js'
import { CHAIN, CHAIN_NAMES, methodOf } from '../dist/syntax.js'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

test('provenance: a frame of any pcbjs package is no user frame, the kicad importer included', () => {
  assert.ok(!isUserFile(`${repo}packages/kicad/dist/library.js`))
  assert.ok(!isUserFile(`${repo}packages/lsp/dist/server.js`))
  assert.ok(!isUserFile(`${repo}packages/core/dist/route.js`))
  assert.ok(!isUserFile('/p/node_modules/@pcbjs/kicad/dist/library.js'))
  assert.ok(!isUserFile('/p/node_modules/vite/dist/node/index.js'))
  assert.ok(!isUserFile('node:internal/modules/esm/loader'))
  assert.ok(isOwnFile('/somewhere/@pcbjs/ui/src/state.ts'))
  assert.ok(isUserFile(`${repo}examples/demo/blinky.pcb.tsx`))
  assert.ok(isUserFile('/home/me/board/packages/mine/src/pcb.tsx'))
})

test('provenance: parseFrame reads every frame form', () => {
  assert.deepEqual(parseFrame('    at f (/a/b.tsx:3:7)'), { file: '/a/b.tsx', line: 3, col: 7 })
  assert.deepEqual(parseFrame('    at /a/b.tsx:3:7'), { file: '/a/b.tsx', line: 3, col: 7 })
  assert.deepEqual(parseFrame('    at async g (file:///a/b%20c.ts:1:2)'), { file: 'file:///a/b%20c.ts', line: 1, col: 2 })
  assert.deepEqual(localFrames('Error\n    at g (file:///a/b%20c.ts:1:2)\n    at h (http://x/y.js:1:1)'), [{ file: '/a/b c.ts', line: 1, col: 2 }])
  assert.deepEqual(parseFrame('    at x (http://h:5173/@fs/a.js:10:4)'), { file: 'http://h:5173/@fs/a.js', line: 10, col: 4 })
  assert.deepEqual(parseFrame('    at script:4:1'), { file: 'script', line: 4, col: 1 })
  assert.equal(parseFrame('Error: boom'), null)
  assert.equal(parseFrame('    at Promise.all (index 0)'), null)
  const stack = `Error: x\n    at a (${repo}packages/kicad/dist/library.js:1:1)\n    at b (/proj/pcb.tsx:5:3)\n    at c (node:internal/x:1:1)`
  assert.equal(framesOf(stack).length, 3)
  assert.deepEqual(userFrames(stack), [{ file: '/proj/pcb.tsx', line: 5, col: 3 }])
})

test('syntax: methodOf names the chain method each step came from', () => {
  for (const name of CHAIN_NAMES) {
    const c = CHAIN[name]
    const st = c.op === 'U' ? { op: 'U', cross: name === 'cross' } : { op: c.op, rel: c.rel }
    assert.equal(methodOf(st), name)
  }
  assert.equal(methodOf({ op: 'XZ' }), 'X')
  assert.equal(methodOf({ op: 'W' }), 'width')
  assert.equal(methodOf({ op: 'B' }), 'branch')
})
