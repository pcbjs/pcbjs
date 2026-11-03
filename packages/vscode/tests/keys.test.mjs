// The extension's keybindings are the editor keys of the key map table in packages/ui/src/keys.ts, so VS Code and the viewer agree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { KEYS, vscodeKeybindings } = require('../dist/keys.cjs')
const { contributes: c } = require('../package.json')

test('keys: the manifest keybindings match the key map table', () => {
  assert.deepEqual(c.keybindings, vscodeKeybindings())
  const editor = KEYS.filter(d => d.editor)
  assert.ok(editor.length >= 6)
  for (const d of editor) assert.ok(c.keybindings.some(k => k.command === d.editor.command))
  const viewKeys = new Set(KEYS.filter(d => !d.editor).flatMap(d => d.keys))
  for (const d of editor) for (const k of d.keys) assert.ok(!viewKeys.has(k), `${k} is both an editor and a view key`)
})

test('keys: restart and clear caches is a palette command bound to Mod+Shift+R while a preview tab is active', () => {
  assert.ok(c.commands.some(x => x.command === 'pcbjs.restartClean' && x.title === 'Restart server and clear caches'))
  assert.ok(c.menus.commandPalette.some(x => x.command === 'pcbjs.restartClean' && x.when === 'pcbjs.active'))
  assert.deepEqual(
    c.keybindings.find(k => k.command === 'pcbjs.restartClean'),
    { command: 'pcbjs.restartClean', key: 'ctrl+shift+r', mac: 'cmd+shift+r', when: "activeWebviewPanelId == 'pcbjs.preview'" },
  )
  const reload = c.commands.find(x => x.command === 'pcbjs.preview.reload')
  assert.equal(reload.title, 'Reload preview')
})
