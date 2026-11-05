import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS } from '../dist/mcp-tools.js'
import { guardSnapshot, pick, queryMethods } from '../dist/session/queries.js'

const tool = name => TOOLS.find(t => t.name === name)
const root = '/tmp/project'
const slots = ['a.tsx', 'b.tsx'].map(rel => ({ entry: { file: `${root}/${rel}`, rel } }))

test('advertised MCP schemas reject malformed scope, unknown keys and render tuples before asking session', async () => {
  let calls = 0
  const cx = {
    root,
    ask() {
      calls++
      throw new Error('session called')
    },
  }
  for (const [name, args] of [
    ['check', { entries: 'a.tsx' }],
    ['check', { entries: [5] }],
    ['check', { entries: ['a.tsx', 5] }],
    ['check', { unexpected: true }],
    ...['toString', 'constructor', '__proto__'].map(key => ['check', JSON.parse(`{\"${key}\":true}`)]),
    ['query', {}],
    ['render', { size: [10] }],
    ['render', { camera: { type: 'perspective', position: [1, 2], target: [0, 0, 0] } }],
    ['render', { marks: [{ type: 'line', at: [1, 2], to: [3] }] }],
    ['render', { marks: [{ type: 'marker', at: [1, 2], extra: true }] }],
  ])
    await assert.rejects(async () => tool(name).run(args, cx), /arguments|render:/)
  assert.equal(calls, 0)
})

test('session selection preserves omitted and empty default, rejects mixed arrays without dropping members', () => {
  for (const entries of [undefined, []]) assert.equal(pick({ slots }, root, entries), slots)
  assert.deepEqual(pick({ slots }, root, ['a.tsx']), [slots[0]])
  for (const entries of ['a.tsx', [5], ['a.tsx', 5]]) assert.throws(() => pick({ slots }, root, entries), /entries/)
  assert.throws(() => pick({ slots }, root, ['missing.tsx']), /not an entry/)
})

test('direct session malformed selection rejects before loading or settling a project', async () => {
  let calls = 0
  const methods = queryMethods({
    api: () => ({
      find: () => {
        calls++
        throw new Error('loaded project')
      },
    }),
  })
  for (const name of ['session/check', 'session/models', 'session/boards']) {
    await assert.rejects(methods[name]({ entries: 'a.tsx' }, {}), /entries/)
  }
  assert.equal(calls, 0)
})

test('expected snapshot refuses identity drift and stale matching identities', () => {
  guardSnapshot({ id: 'now' }, null, 'now')
  for (const [id, stale] of [
    ['later', null],
    ['now', { reason: 'compiling' }],
    ['now', { reason: 'timeout' }],
  ]) {
    assert.throws(() => guardSnapshot({ id }, stale, 'now'), /snapshot changed or stale.*run check again/)
  }
})

test('MCP completed engineering findings preserve structured report and overlay without tool error', async () => {
  for (const entries of [undefined, [], ['a.tsx']]) {
    const e = {
      snapshot: 'verified',
      stale: null,
      overlay: ['a.tsx'],
      value: { stdout: 'DRC findings\n', exitCode: 1, report: { result: 'fail', boards: [{ snapshot: 'geometry' }] }, provenance: { authority: 'editor' } },
    }
    const result = await tool('check').run(entries ? { entries } : {}, {
      root,
      ask: async (method, p) => {
        assert.equal(method, 'session/check')
        assert.deepEqual(p.entries, entries ?? [])
        assert.equal(p.report, true)
        return e
      },
    })
    assert.equal(result.isError, undefined)
    assert.equal(result.structuredContent, e)
    assert.match(result.content[0].text, /unsaved text of a.tsx/)
  }
})

test('MCP render keeps actual envelope metadata and separates expectedSnapshot from spec', async () => {
  const result = await tool('render').run(
    { view: '2d', expectedSnapshot: 'verified' },
    {
      root,
      ask: async (_, p) => {
        assert.equal(p.expectedSnapshot, 'verified')
        assert.deepEqual(p.spec, { view: '2d' })
        return { snapshot: 'verified', stale: { reason: 'changed', current: 'later' }, overlay: ['a.tsx'], value: { png: '', legend: 'view' } }
      },
    },
  )
  assert.match(result.content[1].text, /stale: changed, now later, unsaved text of a.tsx/)
})
