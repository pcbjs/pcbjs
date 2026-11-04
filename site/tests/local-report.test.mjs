import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { localDocs, localDocsWatch, localGroups, localSidebar } from '../scripts/local-docs.mjs'

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'pcbjs-local-docs-'))
  const dir = join(repo, 'docs/local')
  mkdirSync(dir, { recursive: true })
  return { repo, dir, close: () => rmSync(repo, { recursive: true, force: true }) }
}

test('local discovery hides absent/empty folders, uses config labels, and sorts newest first', async () => {
  const f = fixture()
  try {
    assert.deepEqual(await localDocs(f.repo), [])
    writeFileSync(join(f.dir, 'blank.md'), ' \n')
    assert.deepEqual(await localDocs(f.repo), [])
    writeFileSync(join(f.dir, '2026-11-02-first.md'), '# First\n\nDone.')
    writeFileSync(join(f.dir, '2026-11-03-second.md'), '# Second\n\nDone.')
    writeFileSync(join(f.dir, 'config.ts'), `export default { items: [{ file: '2026-11-02-first.md', text: '✅ First round', date: '2026-11-04' }] }`)
    const docs = await localDocs(f.repo)
    assert.deepEqual(
      docs.map(d => [d.title, d.date]),
      [
        ['✅ First round', '2026-11-04'],
        ['Second', '2026-11-03'],
      ],
    )
    assert.equal(docs[0].link, '/local/2026-11-02-first')
    rmSync(join(f.dir, '2026-11-02-first.md'))
    assert.deepEqual(
      (await localDocs(f.repo)).map(d => d.title),
      ['Second'],
      'deleted files disappear even if config still names them',
    )
    rmSync(f.dir, { recursive: true })
    assert.deepEqual(await localDocs(f.repo), [])
  } finally {
    f.close()
  }
})

test('same-day reports follow the newest-first local config order before filename fallback', async () => {
  const f = fixture()
  try {
    for (const name of ['alpha', 'zeta', 'middle']) writeFileSync(join(f.dir, `${name}.md`), `# ${name}`)
    writeFileSync(join(f.dir, 'config.ts'), `export default { items: [{ file: 'alpha.md', date: '2026-11-03' }, { file: 'zeta.md', date: '2026-11-03' }] }`)
    const docs = await localDocs(f.repo)
    assert.deepEqual(
      docs.map(d => d.file),
      ['alpha.md', 'zeta.md', 'middle.md'],
    )
    assert.deepEqual(
      localGroups(docs).map(group => [group.title, group.items.map(doc => doc.title)]),
      [
        ['2026-11-03', ['alpha', 'zeta']],
        ['Undated', ['middle']],
      ],
    )
    assert.deepEqual(
      localSidebar(docs)
        .slice(1)
        .map(group => [group.text, group.items.map(item => item.text)]),
      [
        ['2026-11-03', ['alpha', 'zeta']],
        ['Undated', ['middle']],
      ],
    )
    assert.deepEqual(
      localGroups([docs[2], docs[0], docs[1]]).map(group => group.title),
      ['2026-11-03', 'Undated'],
    )
  } finally {
    f.close()
  }
})

test('production never evaluates local config; discovery does not follow symlinks', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.dir, 'private.md'), '# Private content')
    writeFileSync(join(f.dir, 'config.ts'), `throw new Error('private config must never execute')`)
    assert.deepEqual(await localDocs(f.repo, true), [])
    rmSync(join(f.dir, 'config.ts'))
    writeFileSync(join(f.repo, 'outside.md'), '# Outside')
    symlinkSync(join(f.repo, 'outside.md'), join(f.dir, 'link.md'))
    assert.deepEqual(
      (await localDocs(f.repo)).map(d => d.file),
      ['private.md'],
    )
    writeFileSync(join(f.dir, 'config.ts'), `export default { items: [{ file: '../outside.md' }] }`)
    await assert.rejects(localDocs(f.repo), /relative Markdown filename/)
  } finally {
    f.close()
  }
})

test('local page responses are uncached and excluded from indexing', () => {
  const plugin = localDocsWatch('/repo')
  assert.equal(plugin.apply, 'serve')
  let middleware
  plugin.configureServer({
    watcher: { add() {}, on() {} },
    middlewares: {
      use(fn) {
        middleware = fn
      },
    },
  })
  const headers = {}
  let called = false
  middleware(
    { url: '/local/2026-11-03-review' },
    {
      setHeader(k, v) {
        headers[k] = v
      },
    },
    () => {
      called = true
    },
  )
  assert.equal(headers['Cache-Control'], 'no-store')
  assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow')
  assert.ok(called)
})

const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : fileURLToPath(new URL('../.vitepress/dist/', import.meta.url))
test('production pages, navigation, search and sitemap contain no local documents', { skip: !existsSync(dist) }, () => {
  assert.ok(!existsSync(join(dist, 'local')))
  function check(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) check(file)
      else if (/\.(html|js|json|xml|txt)$/.test(entry.name)) {
        const text = readFileSync(file, 'utf8')
        for (const privateText of ['BATCH1-REPORT.md', '/__local/', '.claude/review', '/local/2026-', '🗂️ Local', 'First UI/UX batch · 13 items', 'private-local-build-sentinel'])
          assert.ok(!text.includes(privateText), `${file}: ${privateText}`)
      }
    }
  }
  check(dist)
})
