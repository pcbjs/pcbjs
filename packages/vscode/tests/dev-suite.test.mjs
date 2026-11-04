import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockSession } from './fake.mjs'

const require = createRequire(import.meta.url)
const { DevSuite, suiteRoot, suiteFolders, stopSuite } = require('../dist/dev-suite.cjs')
const { PROTOCOL, MAJOR } = require('@pcbjs/core/protocol')
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'pcbjs-suite-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
function checkout(name) {
  const root = join(tmp, name)
  for (const file of ['packages/vscode/src/extension.ts', 'packages/core/src/index.ts', 'packages/pcbjs/bin/pcbjs.js']) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), '')
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pcbjs-workspace' }))
  return root
}
const root = checkout('source')
const project = join(root, 'examples/demo')
mkdirSync(project, { recursive: true })
const calls = [
  'save',
  'disconnect',
  'stop',
  'npm run clean',
  'npm run build',
  `pcbjs cache clear --models ${root}`,
  'npm run package -w @pcbjs/vscode',
  'pcbjs ide install',
  'reload',
]
function host(over = {}) {
  const seen = []
  const note = label => {
    seen.push(label)
  }
  return {
    seen,
    development: () => true,
    folders: () => [project],
    projects: () => [project, tmp],
    save: async () => {
      note('save')
      return true
    },
    disconnect: async () => note('disconnect'),
    stop: async (r, dirs) => {
      assert.equal(r, root)
      assert.deepEqual(dirs, [root, project])
      note('stop')
    },
    run: async (tool, args, r) => {
      assert.equal(r, root)
      note(`${tool} ${args.join(' ')}`)
    },
    reload: async () => note('reload'),
    progress() {},
    ...over,
  }
}

test('purge saves, disconnects, stops, clean-builds, clears caches, packages, installs, then reloads', async () => {
  const h = host()
  assert.equal(await new DevSuite().run(h), true)
  assert.deepEqual(h.seen, calls)
  assert.ok(!h.seen.some(s => /uninstall|--force|kill|8080/.test(s)))
})

test('failed save and disabled dev mode have no destructive steps', async () => {
  const h = host({ save: async () => false })
  assert.equal(await new DevSuite().run(h), false)
  assert.deepEqual(h.seen, [])
  const disabled = host({ development: () => false })
  await assert.rejects(new DevSuite().run(disabled), /development mode/)
  assert.deepEqual(disabled.seen, [])
})

for (const failing of calls.slice(1, -1))
  test(`purge stops after failure at ${failing} and can be retried`, async () => {
    const h = host()
    const guard =
      fn =>
      async (...args) => {
        await fn(...args)
        if (h.seen.at(-1) === failing) throw new Error('injected failure')
      }
    for (const key of ['disconnect', 'stop', 'run']) h[key] = guard(h[key])
    const suite = new DevSuite()
    await assert.rejects(suite.run(h), /injected failure/)
    assert.deepEqual(h.seen, calls.slice(0, calls.indexOf(failing) + 1))
    const retry = host()
    assert.equal(await suite.run(retry), true)
    assert.deepEqual(retry.seen, calls)
  })

test('concurrent invocations share one maintenance pipeline', async () => {
  let release
  const h = host({
    save: () =>
      new Promise(done => {
        release = done
      }),
  })
  const suite = new DevSuite()
  const first = suite.run(h)
  assert.equal(suite.run(h), first)
  release(true)
  await first
  assert.deepEqual(h.seen, calls.slice(1))
})

test('source checkout selection rejects arbitrary or ambiguous workspaces and excludes outside symlinks', () => {
  assert.equal(suiteRoot([root, project]), root)
  assert.throws(() => suiteRoot([tmp]), /exactly one/)
  const second = checkout('other')
  assert.throws(() => suiteRoot([root, second]), /exactly one/)
  const link = join(root, 'outside')
  symlinkSync(second, link)
  assert.deepEqual(suiteFolders(root, [project, project, second, link]), [root, project])
})

test('purge verifies the connected session identity before requesting shutdown', async () => {
  const r = checkout('identity')
  const ready = {
    port: 5301,
    host: '127.0.0.1',
    urls: ['http://127.0.0.1:5301/'],
    root: r,
    pid: process.pid,
    version: '0.0.1',
    protocol: PROTOCOL,
    major: MAJOR,
    capabilities: [],
    session: 'replaced-session',
    mode: 'rw',
    projects: [],
  }
  const s = await mockSession(ready)
  mkdirSync(join(r, '.pcbjs'))
  writeFileSync(join(r, '.pcbjs/dev.json'), JSON.stringify(s.dev))
  try {
    await assert.rejects(stopSuite(r, [r]), /record changed/)
    assert.ok(!s.frames.some(f => f.method === 'session/stop'))
  } finally {
    await s.close()
  }
})

test('window closure during packaging prevents subsequent installation and reload', async () => {
  const controller = new AbortController()
  const h = host({ signal: controller.signal })
  const run = h.run
  h.run = async (...args) => {
    await run(...args)
    if (args[1].includes('package')) controller.abort()
  }
  await assert.rejects(new DevSuite().run(h), /window closed/)
  assert.deepEqual(h.seen, calls.slice(0, -2))
})
