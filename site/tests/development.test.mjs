import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  development,
  developmentTopics,
  developmentSidebar,
  developmentLinks,
  developmentLinkRenderer,
  legacyDevelopmentRoutes,
  developmentRedirects,
} from '../scripts/development.mjs'

const repo = new URL('../../', import.meta.url).pathname
const site = join(repo, 'site')
const dist = process.env.PCBJS_SITE_DIST ? resolve(process.env.PCBJS_SITE_DIST) : join(site, '.vitepress/dist')
const skip = !existsSync(join(dist, 'development/index.html'))
const read = p => readFileSync(p, 'utf8')
const html = route => join(dist, route.replace(/^\//, '') + (route.endsWith('/') ? 'index.html' : '.html'))
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

test('six specification sections give each detailed contract exactly one owner', () => {
  assert.deepEqual(
    development.map(s => s.id),
    ['architecture', 'syntax', 'interfaces', 'formats', 'communication', 'interaction'],
  )
  const topics = development.flatMap(s => s.groups.flatMap(g => g.topics.map(([topic]) => topic)))
  assert.equal(new Set(topics).size, topics.length)
  assert.equal(developmentTopics.size, topics.length)
  for (const section of development) {
    assert.ok(existsSync(join(site, 'development', section.id, 'index.md')))
    for (const group of section.groups) for (const [topic] of group.topics) assert.ok(existsSync(join(repo, 'docs', topic + '.md')), topic)
    for (const [page] of section.pages ?? []) assert.ok(existsSync(join(site, 'development', section.id, page + '.md')))
  }
  assert.equal(developmentTopics.get('routing').section, 'syntax')
  assert.equal(developmentTopics.get('ide-bridge').section, 'communication')
  assert.equal(developmentTopics.get('editor-actions').section, 'interaction')
})

test('topic links become canonical without rewriting executable examples or external links', () => {
  const topics = new Set([...developmentTopics.keys(), 'cli'])
  const md = '[Route](./routing#branches) [Board](board.md#layers) [CLI](/docs/cli) [External](https://example.test/routing)\n```tsx\nconst url = "[route](./routing)"\n```'
  const result = developmentLinks(md, topics)
  assert.ok(result.includes('[Route](/development/syntax/routing#branches)'))
  assert.ok(result.includes('[Board](/development/syntax/board#layers)'))
  assert.ok(result.includes('[CLI](/docs/cli)'))
  assert.ok(result.includes('[External](https://example.test/routing)'))
  assert.ok(result.includes('const url = "[route](./routing)"'))
})

test('overview source links point to real definitions and do not claim universal acceptance', () => {
  for (const file of walk(join(site, 'development')).filter(p => p.endsWith('.md'))) {
    const text = read(file)
    for (const m of text.matchAll(/https:\/\/github\.com\/pcbjs\/pcbjs\/blob\/main\/([^\s)#]+)/g)) assert.ok(existsSync(join(repo, m[1])), `${file}: ${m[1]}`)
  }
  const conformance = read(join(site, 'development/conformance.md'))
  assert.match(conformance, /does not mean that its end-to-end behavior passed/)
  assert.match(conformance, /no complete language-neutral schema registry/)
})

test('built Development pages expose all sections, detail pages, source edit links and compatibility routes', { skip }, () => {
  const home = read(html('/development/'))
  assert.match(home, /Development/)
  const nav = home.match(/<nav[^>]*id="VPSidebarNav"[\s\S]*?<\/nav>/)?.[0]
  assert.ok(nav, 'dedicated native sidebar')
  for (const s of development) assert.ok(nav.includes(s.title), s.title)
  function links(items) {
    return items.flatMap(i => [...(i.link ? [i.link] : []), ...links(i.items ?? [])])
  }
  for (const route of links(developmentSidebar)) assert.ok(existsSync(html(route)), route)
  for (const [topic, spec] of developmentTopics) {
    const page = read(html(spec.link))
    assert.ok(page.includes(`https://github.com/pcbjs/pcbjs/edit/main/docs/${topic}.md`), `${topic}: edit original Markdown`)
    assert.ok(page.includes(`rel="canonical" href="https://pcbjs.dev${spec.link}"`), `${topic}: canonical URL`)
    const legacy = read(html(`/docs/${topic}`))
    assert.ok(legacy.includes(`href="${spec.link}"`), `${topic}: no-JS compatibility link`)
    assert.ok(legacy.includes(`rel="canonical" href="https://pcbjs.dev${spec.link}"`), `${topic}: no duplicate canonical document`)
    assert.ok(!legacy.includes('id="VPSidebarNav"'), 'redirects do not duplicate full documentation shells')
  }
  assert.ok(read(html('/development/interaction/editor-actions')).includes('Root') || read(html('/development/interaction/editor-actions')).includes('workspace-root'))
  assert.ok(read(html('/development/syntax/routing')).includes('id="branches"'), 'old section anchors remain valid')
})

test('guide and feature links bypass legacy redirect routes without changing unrelated links', () => {
  let called = false
  const md = {
    renderer: {
      rules: {
        link_open: () => {
          called = true
          return '<a>'
        },
      },
    },
  }
  developmentLinkRenderer(md)
  const token = href => ({
    href,
    attrGet() {
      return this.href
    },
    attrSet(key, value) {
      assert.equal(key, 'href')
      this.href = value
    },
  })
  for (const [before, after] of [
    ['/docs/routing#branches', '/development/syntax/routing#branches'],
    ['/docs/quickstart', '/guide/getting-started/quickstart'],
    ['/docs/cli', '/docs/cli'],
    ['./routing', './routing'],
  ]) {
    const item = token(before)
    assert.equal(md.renderer.rules.link_open([item], 0, {}, {}, {}), '<a>')
    assert.equal(item.href, after)
  }
  assert.ok(called)
})

test('old section URLs redirect to Development under root and versioned bases', () => {
  for (const base of ['/', '/stable/']) {
    const plugin = developmentRedirects(base, 'https://pcbjs.dev')
    const emitted = []
    plugin.generateBundle.call({ emitFile: file => emitted.push(file) })
    assert.equal(emitted.length, legacyDevelopmentRoutes.size)
    for (const asset of emitted) {
      assert.ok(asset.fileName.startsWith('specifications/'))
      assert.ok(asset.source.includes(`href="https://pcbjs.dev${base}development/`))
      assert.ok(asset.source.includes('+location.search+location.hash'))
      assert.ok(asset.source.includes('name="robots" content="noindex"'))
      assert.ok(!asset.source.includes('/assets/'), 'no duplicate application bundle')
    }
    let handler
    plugin.configureServer({
      middlewares: {
        use(fn) {
          handler = fn
        },
      },
    })
    let response
    handler(
      { url: base + 'specifications/syntax/routing.html?q=test' },
      {
        writeHead(status, headers) {
          response = { status, headers }
          return { end() {} }
        },
      },
      () => assert.fail('known legacy route'),
    )
    assert.equal(response.status, 302)
    assert.equal(response.headers.Location, base + 'development/syntax/routing?q=test')
  }
})
