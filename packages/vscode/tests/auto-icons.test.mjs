import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { autoIcons, revokeIcons, OFFERED, THEME_BEFORE } = require('../dist/auto-icons.cjs')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = 'material-icon-theme.files.associations'
const FOLDERS = 'material-icon-theme.folders.associations'

/** User settings, globalState, the two prompts and the commands run, recorded. */
function fakeEnv(theme, settings = {}) {
  const env = {
    root,
    settings: { ...settings },
    state: new Map(),
    commands: [],
    shown: [],
    offers: [],
    take: false,
    undo: undefined,
    writes: 0,
    theme: () => env.settings['workbench.iconTheme'] ?? theme,
    extensionDist: id => (id === 'PKief.material-icon-theme' ? '/home/u/.vscode/extensions/pkief.material-icon-theme-5.0.0/dist' : undefined),
    user: key => env.settings[key],
    setUser: async (key, value) => {
      env.writes++
      if (value === undefined) delete env.settings[key]
      else env.settings[key] = value
    },
    stored: key => env.state.get(key),
    store: async (key, value) => void (value === undefined ? env.state.delete(key) : env.state.set(key, value)),
    command: async id => void env.commands.push(id),
    added: (text, undo) => {
      env.shown.push(text)
      env.undo = undo
    },
    offer: async text => (env.offers.push(text), env.take),
  }
  return env
}

test('Material: the board, schematic and config names and the fab folder, by paths that reach the SVGs from its dist folder', async () => {
  const env = fakeEnv('material-icon-theme', { [FILES]: { '*.md': 'markdown' } })
  const run = () => autoIcons(env)
  assert.equal(await run(), 'pcbjs: file icons added to Material Icon Theme')
  const files = env.settings[FILES]
  for (const k of ['pcb.tsx', '*.pcb.tsx', '*.sch.ts', '*.sch.tsx', 'pcb.config.ts', 'pcb.config.mts', 'pcb.config.js', 'pcb.config.mjs']) assert.ok(files[k], k)
  assert.equal(files['*.md'], 'markdown')
  const dist = env.extensionDist('PKief.material-icon-theme')
  assert.ok(files['pcb.tsx'].startsWith('../'))
  for (const v of [...Object.values(files).filter(v => v.includes('assets/')), env.settings[FOLDERS].fab]) {
    // Material resolves the path from its dist folder and adds .svg
    const abs = resolve(dist, `${v}.svg`)
    assert.ok(existsSync(abs), `${v} -> ${abs}`)
  }
  assert.equal(env.shown.length, 1)
  // nothing missing or stale: no second write and no second message
  const writes = env.writes
  assert.equal(await run(), undefined)
  assert.equal(env.writes, writes)
  // undo removes exactly the keys written
  await env.undo()
  assert.deepEqual(env.settings[FILES], { '*.md': 'markdown' })
  assert.equal(env.settings[FOLDERS], undefined)
})

test('Material: a stale path from an older install is rewritten', async () => {
  const env = fakeEnv('material-icon-theme', {
    [FILES]: { 'pcb.tsx': '../../old/pcbjs-0.0.0/assets/icons/dark/entry', 'lib.tsx': '../../old/pcbjs-0.0.0/assets/icons/dark/footprint' },
  })
  await autoIcons(env)
  assert.ok(!Object.values(env.settings[FILES]).some(v => v.includes('/old/')))
})

test('vscode-icons: associations with light variants and the custom icon folder; undo leaves the user its own', async () => {
  const own = { icon: 'js', extensions: ['mjs'], format: 'svg' }
  const env = fakeEnv('vscode-icons', { 'vsicons.associations.files': [own] })
  assert.equal(await autoIcons(env), 'pcbjs: file icons added to vscode-icons')
  const files = env.settings['vsicons.associations.files']
  assert.deepEqual(files[0], own)
  const entry = files.find(e => e.icon === 'pcbjs_entry' && e.filename)
  assert.deepEqual(entry.extensions, ['pcb.tsx'])
  assert.ok(files.every(e => e === own || e.light))
  const dir = env.settings['vsicons.customIconFolderPath']
  for (const e of files.filter(e => e !== own))
    assert.ok(existsSync(join(dir, 'vsicons-custom-icons', `file_type_${e.icon}.svg`)) && existsSync(join(dir, 'vsicons-custom-icons', `file_type_light_${e.icon}.svg`)), e.icon)
  const writes = env.writes
  await autoIcons(env)
  assert.equal(env.writes, writes)
  await env.undo()
  assert.deepEqual(env.settings['vsicons.associations.files'], [own])
  assert.equal(env.settings['vsicons.customIconFolderPath'], undefined)
})

test('another theme: one offer of the pcbjs icon theme, never again once dismissed; taken, it switches', async () => {
  const env = fakeEnv('vs-seti')
  await autoIcons(env)
  await autoIcons(env)
  assert.equal(env.offers.length, 1)
  assert.equal(env.state.get(OFFERED), true)
  assert.equal(env.settings['workbench.iconTheme'], undefined)
  const yes = fakeEnv('vs-seti')
  yes.take = true
  await autoIcons(yes)
  assert.equal(yes.settings['workbench.iconTheme'], 'pcbjs')
  assert.equal(yes.writes, 1)
  await autoIcons(yes)
  assert.equal(yes.offers.length, 1)
})

test('revoke under Material: only the associations that point at the extension go, the offer may show again', async () => {
  const env = fakeEnv('material-icon-theme', { [FILES]: { '*.md': 'markdown' } })
  await autoIcons(env)
  env.state.set(OFFERED, true)
  assert.equal(await revokeIcons(env), 'pcbjs: removed the Material Icon Theme associations.')
  assert.deepEqual(env.settings[FILES], { '*.md': 'markdown' })
  assert.equal(env.settings[FOLDERS], undefined)
  assert.equal(env.state.has(OFFERED), false)
  assert.deepEqual(env.commands, ['vscode-icons.regenerateIcons'])
})

test('revoke under another theme: the vscode-icons entries, both kinds, and the icon folder go, the user folder comes back', async () => {
  const own = { icon: 'js', extensions: ['mjs'], format: 'svg' }
  const env = fakeEnv('vscode-icons', { 'vsicons.associations.files': [own], 'vsicons.customIconFolderPath': '/home/u/my-icons' })
  await autoIcons(env)
  assert.ok(env.settings['vsicons.associations.folders'].length)
  env.settings['workbench.iconTheme'] = 'vs-minimal'
  assert.equal(await revokeIcons(env), 'pcbjs: removed the vscode-icons associations.')
  assert.deepEqual(env.settings['vsicons.associations.files'], [own])
  assert.equal(env.settings['vsicons.associations.folders'], undefined)
  assert.equal(env.settings['vsicons.customIconFolderPath'], '/home/u/my-icons')
  assert.equal(env.settings['workbench.iconTheme'], 'vs-minimal')
})

test('revoke under the pcbjs theme: back to the theme before the switch, or to vs-seti', async () => {
  const env = fakeEnv('vs-minimal')
  env.take = true
  await autoIcons(env)
  assert.equal(env.state.get(THEME_BEFORE), 'vs-minimal')
  assert.equal(await revokeIcons(env), 'pcbjs: removed the pcbjs icon theme, back to vs-minimal.')
  assert.equal(env.settings['workbench.iconTheme'], 'vs-minimal')
  assert.equal(env.state.size, 0)
  const picked = fakeEnv('pcbjs')
  await revokeIcons(picked)
  assert.equal(picked.settings['workbench.iconTheme'], 'vs-seti')
})

test('revoke with nothing to remove writes no setting', async () => {
  const env = fakeEnv('vs-seti', {
    [FILES]: { '*.md': 'markdown' },
    'vsicons.associations.files': [{ icon: 'js', extensions: ['mjs'] }],
    'vsicons.customIconFolderPath': '/home/u/my-icons',
  })
  assert.equal(await revokeIcons(env), 'pcbjs: no pcbjs file icons to remove.')
  assert.equal(env.writes, 0)
  assert.equal(env.settings['vsicons.customIconFolderPath'], '/home/u/my-icons')
})
