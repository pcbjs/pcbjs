// The installed version in the status bar, installed, skewed and missing; the dist-tag resolution for a release and a pre-release
// build, the checkbox and the offline fallback, against a mocked registry; the install flow's terminal; the recommendation files.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { terminals, ui } from './vscode.mjs'

const require = createRequire(import.meta.url)
const { installed, versionStatus, resolveInstall, distTags, compareVersions, installCommand, installDir, prereleaseDefault } = require('../dist/version.cjs')
const { installFlow, pickVersion } = require('../dist/install.cjs')
const { recommendExtension, recommendInDevcontainers, stripJsonc } = require('../dist/recommend.cjs')

const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'pcbjs-version-')))
after(() => rmSync(tmp, { recursive: true, force: true }))
let n = 0
/** A folder with the @pcbjs packages at the versions given. */
function folder(versions = {}) {
  const d = path.join(tmp, `f${n++}`)
  mkdirSync(d, { recursive: true })
  for (const [name, version] of Object.entries(versions)) {
    const dir = path.join(d, 'node_modules', '@pcbjs', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@pcbjs/${name}`, version }))
  }
  return d
}
const reset = () => Object.assign(ui, { answers: [], calls: [], folders: [], files: [], clipboard: [] })
const TAGS = { latest: '0.0.0', beta: '0.0.1-beta.3', next: '0.0.0-next-20261031' }
const registry = tags => {
  const urls = []
  const fetch = async (url, init) => {
    urls.push(url)
    assert.ok(init.signal, 'every fetch has a timeout')
    if (tags instanceof Error) throw tags
    return { ok: true, json: async () => tags }
  }
  return { fetch, urls }
}

test('the status bar: the version of @pcbjs/pcbjs, the warning colour on a skew, Not installed with the install flow', () => {
  const ok = installed(folder({ pcbjs: '0.0.1-beta.2', cli: '0.0.1-beta.2', core: '0.0.1-beta.0', vscode: '0.3.1' }))
  assert.equal(ok.version, '0.0.1-beta.2')
  assert.equal(ok.skew, null, 'one major.minor, the extension left out as doctor leaves it')
  assert.deepEqual(versionStatus(ok, '2 boards'), {
    text: '$(circuit-board) pcbjs 0.0.1-beta.2: 2 boards',
    warning: false,
    command: null,
    tooltip: `@pcbjs/pcbjs 0.0.1-beta.2 in ${path.join(tmp, 'f0')}`,
  })

  const skewed = installed(folder({ pcbjs: '0.1.0', cli: '0.1.0', core: '0.0.1-beta.0' }))
  assert.match(skewed.skew, /@pcbjs packages disagree on the version: @pcbjs\/cli 0\.1\.0, @pcbjs\/core 0\.0\.1-beta\.0, @pcbjs\/pcbjs 0\.1\.0/)
  const s = versionStatus(skewed, null)
  assert.equal(s.text, '$(warning) pcbjs 0.1.0')
  assert.equal(s.warning, true)
  assert.equal(s.command, 'pcbjs.install')

  const none = installed(folder())
  assert.deepEqual(none, { version: null, dir: null, skew: null, linked: false })
  assert.deepEqual(versionStatus(none, null), {
    text: '$(circuit-board) pcbjs: Not installed',
    warning: false,
    command: 'pcbjs.install',
    tooltip: '@pcbjs/pcbjs is not installed in this folder. Click to install it.',
  })

  // a symlinked package is a source tree whose version is the last train's, shown as +dev
  const linkedDir = folder({ cli: '0.0.1-beta.2', core: '0.0.1-beta.2' })
  mkdirSync(path.join(linkedDir, 'src-pcbjs'))
  writeFileSync(path.join(linkedDir, 'src-pcbjs', 'package.json'), JSON.stringify({ name: '@pcbjs/pcbjs', version: '0.0.1-beta.2' }))
  symlinkSync(path.join(linkedDir, 'src-pcbjs'), path.join(linkedDir, 'node_modules', '@pcbjs', 'pcbjs'))
  const linked = installed(linkedDir)
  assert.equal(linked.linked, true)
  assert.equal(versionStatus(linked, '1 board').text, '$(circuit-board) pcbjs 0.0.1-beta.2+dev: 1 board')

  // a project inside the folder resolves from its own folder up, as Node does
  const outer = folder({ pcbjs: '0.0.1-beta.1' })
  mkdirSync(path.join(outer, 'boards', 'a'), { recursive: true })
  assert.equal(installed(path.join(outer, 'boards', 'a')).version, '0.0.1-beta.1')
  writeFileSync(path.join(outer, 'boards', 'package.json'), '{}')
  assert.equal(installDir(outer, path.join(outer, 'boards', 'a', 'pcb.tsx')), path.join(outer, 'boards'))
  assert.equal(installDir(outer), outer)
})

test('dist-tags: latest for a release build, the newest of the three with the checkbox or a pre-release build, the packaged version offline', async () => {
  assert.deepEqual(resolveInstall(TAGS, false, '0.1.0'), { spec: 'latest', version: '0.0.0', tag: 'latest', offline: false })
  assert.deepEqual(resolveInstall(TAGS, true, '0.1.0'), { spec: 'beta', version: '0.0.1-beta.3', tag: 'beta', offline: false })
  assert.deepEqual(resolveInstall({ ...TAGS, next: '0.0.1-beta.4' }, true, '0.1.0').tag, 'next')
  assert.deepEqual(resolveInstall({ latest: '0.2.0', beta: '0.2.0-beta.9' }, true, '0.1.0').tag, 'latest', 'a release beats its own betas')
  assert.deepEqual(resolveInstall(null, true, '0.0.1-beta.1'), { spec: '0.0.1-beta.1', version: '0.0.1-beta.1', tag: null, offline: true })
  assert.equal(prereleaseDefault('0.0.1-beta.1'), true)
  assert.equal(prereleaseDefault('0.1.0'), false)
  assert.equal(installCommand(resolveInstall(TAGS, true, '0.1.0')), 'npm install -D @pcbjs/pcbjs@beta')
  assert.equal(installCommand(resolveInstall(null, false, '0.1.0')), 'npm install -D @pcbjs/pcbjs@0.1.0')
  assert.ok(compareVersions('0.0.1-beta.10', '0.0.1-beta.9') > 0)
  assert.ok(compareVersions('0.0.1', '0.0.1-beta.9') > 0)

  const r = registry(TAGS)
  assert.deepEqual(await distTags(r.fetch), TAGS)
  assert.deepEqual(r.urls, ['https://registry.npmjs.org/-/package/@pcbjs/pcbjs/dist-tags'])
  assert.equal(await distTags(registry(new Error('ENOTFOUND')).fetch), null)
  assert.equal(await distTags(async () => ({ ok: false, json: async () => ({}) })), null)
})

test('the install flow: a release build shows latest with the checkbox off, the checkbox flips to the newest, the terminal runs npm install -D', async () => {
  reset()
  const shown = []
  ui.answers.push(
    ['quickPick', o => (shown.push(o.items.map(i => i.label)), o.items[1])],
    ['quickPick', o => (shown.push(o.items.map(i => [i.label, i.description, i.detail])), o.items[0])],
  )
  const root = folder()
  const r = await installFlow({ packaged: '0.1.0', fetch: registry(TAGS).fetch }, root)
  assert.deepEqual(shown[0], ['$(cloud-download) Install @pcbjs/pcbjs 0.0.0', '$(circle-large-outline) Include the beta and next dist-tags'])
  assert.deepEqual(shown[1], [
    ['$(cloud-download) Install @pcbjs/pcbjs 0.0.1-beta.3', 'npm install -D @pcbjs/pcbjs@beta', 'the beta dist-tag'],
    ['$(pass-filled) Include the beta and next dist-tags', undefined, 'latest 0.0.0, beta 0.0.1-beta.3, next 0.0.0-next-20261031'],
  ])
  assert.equal(r.version, '0.0.1-beta.3')
  const t = terminals.at(-1)
  assert.deepEqual([t.name, t.cwd, t.sent, t.shown], ['pcbjs install', root, ['npm install -D @pcbjs/pcbjs@beta'], 1])
})

test('the install flow: a pre-release build has the checkbox on; offline it offers the packaged version; Escape installs nothing', async () => {
  reset()
  let items
  ui.answers.push(['quickPick', o => ((items = o.items), 'active')])
  const r = await pickVersion({ packaged: '0.0.1-beta.1', fetch: registry(TAGS).fetch }, 't', 'Install')
  assert.equal(items[1].label, '$(pass-filled) Include the beta and next dist-tags')
  assert.equal(r.version, '0.0.1-beta.3')

  ui.answers.push(['quickPick', o => ((items = o.items), 'active')])
  const off = await pickVersion({ packaged: '0.0.1-beta.1', fetch: registry(new Error('offline')).fetch }, 't', 'Install')
  assert.equal(off.version, '0.0.1-beta.1')
  assert.equal(items[0].detail, 'offline: 0.0.1-beta.1 is the version this extension was packaged against')
  assert.equal(items[1].detail, 'the registry did not answer')

  const before = terminals.length
  assert.equal(await installFlow({ packaged: '0.1.0', fetch: registry(TAGS).fetch }, folder()), undefined)
  assert.equal(terminals.length, before)
})

test('the recommendation: extensions.json created or merged, a devcontainer entry only where one exists, a commented file left alone', () => {
  const d = folder()
  assert.deepEqual(recommendExtension(d), ['recommended pcbjs.vscode-pcbjs in .vscode/extensions.json'])
  assert.deepEqual(JSON.parse(readFileSync(path.join(d, '.vscode', 'extensions.json'), 'utf8')), { recommendations: ['pcbjs.vscode-pcbjs'] })
  assert.deepEqual(recommendExtension(d), [], 'once')
  assert.deepEqual(recommendInDevcontainers(d), [])
  assert.ok(!existsSync(path.join(d, '.devcontainer')))

  const e = folder()
  mkdirSync(path.join(e, '.vscode'))
  writeFileSync(path.join(e, '.vscode', 'extensions.json'), '{ "recommendations": ["dbaeumer.vscode-eslint"] }')
  mkdirSync(path.join(e, '.devcontainer'))
  writeFileSync(path.join(e, '.devcontainer', 'devcontainer.json'), JSON.stringify({ image: 'node:22', customizations: { vscode: { settings: {} } } }))
  writeFileSync(path.join(e, '.devcontainer.json'), '{\n  // the image\n  "image": "node:22",\n}\n')
  recommendExtension(e)
  assert.deepEqual(JSON.parse(readFileSync(path.join(e, '.vscode', 'extensions.json'), 'utf8')).recommendations, ['dbaeumer.vscode-eslint', 'pcbjs.vscode-pcbjs'])
  assert.deepEqual(recommendInDevcontainers(e), [
    'recommended pcbjs.vscode-pcbjs in .devcontainer/devcontainer.json',
    '.devcontainer.json has comments, so add "pcbjs.vscode-pcbjs" to customizations.vscode.extensions by hand',
  ])
  assert.deepEqual(JSON.parse(readFileSync(path.join(e, '.devcontainer', 'devcontainer.json'), 'utf8')).customizations.vscode, { settings: {}, extensions: ['pcbjs.vscode-pcbjs'] })
  assert.match(readFileSync(path.join(e, '.devcontainer.json'), 'utf8'), /\/\/ the image/)
  assert.deepEqual(JSON.parse(stripJsonc('{ "a": "// not a comment", /* c */ "b": [1,], }')), { a: '// not a comment', b: [1] })
})
